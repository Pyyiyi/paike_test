# D06 五视图、拖拽调课、撤销重做与空闲查询设计

> 状态：设计态。本文定义五视图查询、空闲互补、拖拽校验、整批调课、撤销/重做与前端交互契约；不包含业务实现、页面实现或已执行运行时测试。
> 权威输入：PRD F11/F12/F13、R-025~R-030、A-15/A-21/A-22、`p2-contracts.md` §4、`roles.md` §3、D05 设计。

## 1. 范围、依赖与不变量

### 1.1 范围

- `TimetableViewQueryService`：班级 / 教师 / 全校 / 场地 / 任课五维聚合的唯一数据源。
- `IdleSlotQueryService`：复用同一占用读取，计算「模板开放槽位 − 已占用」的严格补集。
- 只读接口：`/timetables`、`/my/timetable`、`/my/classes`、`/my/classes/{classId}/timetable`、`/idle-slots`、`/my/idle-slots`。
- 写入接口：`moves/validate`、`adjustments`、`adjustments/undo`、`adjustments/redo` 的契约与事务边界。
- 前端契约：`TimetableGrid`、维度切换、单双周渲染、拖拽回弹、冲突高亮、二次确认、撤销/重做按钮、空闲页和教师个人视图。
- 迁移草案：`0022_timetable_adjustment_indexes.sql`（只补索引；`adjustment_history` 由 D05 的 `0021` 建表）。

### 1.2 非范围

- 不实现 D05 的排课引擎、方案生成、发布/覆盖、锁定/解锁、冲突中心。
- 不实现 D07 的学期存档编排；本卡只消费 `semester.status='ARCHIVED'` 并返回 409。
- 不实现 D11 的工作量统计；本卡只提供同一课表数据源的查询契约。
- 本轮不把 `0022_*` 放入 `migrations/`，不实现服务、API 或 Vue 页面。D02/D03 查询服务仍为设计态。

### 1.3 依赖状态

| 依赖 | 当前基线 | D06 使用方式 |
|------|----------|--------------|
| D01 学期/模板/校历 | 已实现 QueryService | `SemesterQueryService`、`TemplateQueryService` 取学期、钉扎模板版本、开放星期与节次 |
| D02 班级/科目规则 | 设计态 | `ClassQueryService`、`SubjectQueryService`；D05 已声明 `listSchedulingClasses` / `listSchedulingSubjects` 最小接口 |
| D03 教师/任课 | 设计态 | `TeacherQueryService`、`AssignmentQueryService` 批量读取教师与任课 |
| D04 场地/合班/走班 | 已实现 QueryService | `VenueQueryService`、`SchedulingUnitQueryService` |
| D05 课次/冲突/历史 | 设计态，SQL 草案 0020/0021 | 只读 `lesson`、`lesson_class`；写 `adjustment_history`、`operation_log`、`sys_outbox_event` |
| P0-01 outbox | 已实现 | 同一事务 `appendEvent` |
| P0-03 幂等/版本 | 已实现 | `withTransaction`、版本校验、统一错误包络 |

> 本卡不直接 join registry/resource 私有表：名称解析全部走 QueryService（`conventions.md` §2.2）。

### 1.4 强制不变量

1. 五视图只能由 `TimetableViewQueryService` 产出；`IdleSlotQueryService` 只复用其占用读取，不新增第二套课表查询；禁止前端自行聚合。
2. 同一课次在任意视图中返回的 `lessonId`、`subjectName`、`teacherName`、`classNames`、`venueName`、`weekParity`、`locked` 必须一致。
3. 空闲槽位 = 模板开放槽位 − 已占用槽位；按单双周展开后 `occupied ∪ idle = open` 且 `occupied ∩ idle = ∅`。
4. 所有查询强制 `semesterId`；方案必须属于该学期；跨学期不得返回任何课次、模板或日志。
5. 教师只能访问本人教师视图、本人关联班级视图和本人空闲；其余维度或对象返回 `403 FORBIDDEN`。
6. `moves/validate` 零写入；任一调课操作冲突、锁定、存档或版本不匹配，整批零写入。
7. `adjustments` 必须携带 `confirm=true`；未确认、缺字段或 `confirm=false` 一律 `400/409`，零写入。
8. 成功保存写入：`lesson` 变更、`timetable_plan.version+1`、`adjustment_history`（APPLY）、`operation_log`（`ADJUST`）、每课次 `bc.timetable.lesson.moved` 事件，同一事务。
9. 撤销/重做以一次确认保存的 `unitId` 为单元；服务端读取历史并重校验，整组失败即整组零写入。
10. 撤销栈上限 50 个单元；离开方案、刷新页面或切换会话后清空；服务端历史保留，客户端不再持有 `unitId`。
11. 锁定课次移动一律 `409 STATE_CONFLICT`；存档学期所有调课写请求一律 `409 STATE_CONFLICT`。
12. 单双周语义：`ALL` 同时占用 `ODD` 与 `EVEN`；`ODD` 只占 `ODD`；`EVEN` 只占 `EVEN`。

## 2. 查询数据模型

### 2.1 迁移草案

| 迁移 | 内容 | 设计文件 |
|------|------|----------|
| `0022_timetable_adjustment_indexes.sql` | 五视图过滤、单双周、调课历史重放、操作日志追溯索引 | `docs/knowledge/designs/0022_timetable_adjustment_indexes.sql` |

`0022` 不建表、不改列、不改枚举；只补 `lesson`、`adjustment_history`、`operation_log`、`timetable_plan` 的查询索引。这样 D05 的 `0020/0021` 可以独立执行，D06 只负责查询与审计性能。

### 2.2 课次读取模型

D06 只读取 timetable 自有表：

```text
lesson(lesson_id, plan_id, weekday, period, week_parity, subject_id, teacher_id,
       venue_id, unit_type, unit_id, locked)
lesson_class(lesson_id, class_id)
timetable_plan(plan_id, semester_id, status, version, schedule_template_version_id)
semester(semester_id, status, schedule_template_version_id)
schedule_template_version(version_id, open_weekdays, periods)
```

名称解析：

| 字段 | 来源 |
|------|------|
| `subjectName` | `SubjectQueryService.listSchedulingSubjects()` |
| `teacherName` | `TeacherQueryService` 批量读取 |
| `classNames` | `ClassQueryService.listSchedulingClasses()` + `lesson_class.class_id` |
| `venueName` | `VenueQueryService` 批量读取 |
| 任课单元名称 | `SchedulingUnitQueryService.list()`（仅选择器/响应辅助，不参与课次身份） |

读取在只读 `REPEATABLE READ` 事务中完成；先读课次集合，再按稳定顺序批量解析名称。名称解析失败不得用空字符串兜底，必须抛出可定位错误。

### 2.3 方案解析

`/timetables` 与 `/idle-slots` 接受可选 `planId`：

1. 传 `planId`：必须属于 `semesterId`、未逻辑删除、状态为 `DRAFT` 或 `PUBLISHED`；否则 `404 NOT_FOUND` 或 `409 STATE_CONFLICT`。
2. 不传 `planId`：优先 `PUBLISHED`；没有正式方案时取 `generation_no DESC, updated_at DESC, plan_id` 的最新 `DRAFT`。
3. 没有可用方案：返回空课表（`cells=[]`、`weekdays/periods` 来自模板）而不是 404；空闲接口返回模板全部开放槽位。
4. 方案的 `schedule_template_version_id` 必须等于学期钉扎版本；不一致返回 `409 STATE_CONFLICT`，不自动改钉扎版本。

### 2.4 单双周展开

设开放槽位 `S = openWeekdays × periods[].periodNo`。

| 查询 `parity` | 课表渲染 | 占用展开 | 空闲展开 | 返回 `weekParity` |
|---------------|----------|----------|----------|-------------------|
| `ALL` | 显示 `ALL/ODD/EVEN` 全部课次 | `ALL→{ODD,EVEN}`、`ODD→{ODD}`、`EVEN→{EVEN}` | `S×{ODD,EVEN} − occupied` | 两格都空闲→`ALL`；仅单周→`ODD`；仅双周→`EVEN` |
| `ODD` | 显示 `ALL+ODD` | `ALL→{ODD}`、`ODD→{ODD}`、`EVEN→∅` | `S×{ODD} − occupied` | 恒 `ODD` |
| `EVEN` | 显示 `ALL+EVEN` | `ALL→{EVEN}`、`EVEN→{EVEN}`、`ODD→∅` | `S×{EVEN} − occupied` | 恒 `EVEN` |

`ALL` 视图下同一槽位可能同时出现 `ALL` 与 `ODD/EVEN` 课次；这是合法数据，冲突校验按展开后的周次集合判断。

## 3. TimetableViewQueryService

### 3.1 接口

```ts
interface TimetableViewQuery {
  semesterId: string;
  planId?: string;
  dimension: 'CLASS' | 'TEACHER' | 'SCHOOL' | 'VENUE' | 'ASSIGNMENT';
  objectId?: string;
  unitType?: 'ASSIGNMENT' | 'COMBINED_CLASS' | 'WALKING_GROUP';
  parity: 'ALL' | 'ODD' | 'EVEN';
  actor: { userId: string; role: 'ADMIN' | 'TEACHER'; teacherId: string | null };
}

interface TimetableViewQueryService {
  query(input: TimetableViewQuery): Promise<TimetableView>;
  loadOccupancy(input: {
    semesterId: string;
    planId?: string;
    dimension: 'CLASS' | 'TEACHER';
    objectId: string;
    parity: 'ALL' | 'ODD' | 'EVEN';
    actor: TimetableViewQuery['actor'];
  }): Promise<OccupiedSlot[]>;
}
```

`loadOccupancy` 与 `query` 共用同一个 `readPlanLessons()` 内部函数；禁止另写一套空闲专用课次 SQL。

### 3.2 维度过滤键

| `dimension` | `objectId` | 过滤条件 | 说明 |
|-------------|------------|----------|------|
| `CLASS` | 班级 UUID | `exists(lesson_class where lesson_id=l.lesson_id and class_id=$objectId)` | 班级视图 |
| `TEACHER` | 教师 UUID | `l.teacher_id=$objectId` | 教师视图 |
| `SCHOOL` | 禁止传入 | 无对象过滤 | 全校总课表 |
| `VENUE` | 场地 UUID | `l.venue_id=$objectId` | 未指定场地的课次不进入场地视图 |
| `ASSIGNMENT` | 教学单元 UUID | `l.unit_id=$objectId and l.unit_type=$unitType` | 常规任课/合班/走班统一按教学单元展示 |

校验规则：`SCHOOL` 必须省略 `objectId`；其余维度必须提供 `objectId`；`ASSIGNMENT` 必须同时提供 `unitType`；非 `ASSIGNMENT` 维度不得提供 `unitType`。违反返回 `400 VALIDATION_ERROR`。

### 3.3 聚合与排序

1. 读取 `lesson` + `lesson_class`，按 `(weekday, period, lesson_id)` 稳定排序。
2. 对每个课次：科目取 `subject_id` 名称；教师取 `teacher_id` 名称；班级取 `lesson_class` 全量并保持班级稳定顺序（年级排序号、班序号、班级名）；场地取 `venue_id` 名称，未指定时为 `null`。
3. `cells` 每项对应一个课次，不是网格单元格；同一 `(weekday,period)` 允许多个课次（全校/合班/走班场景）。
4. `weekdays` 返回模板 `openWeekdays` 升序；`periods` 返回模板 `periods` 按 `periodNo` 升序，字段为 `periodNo/startTime/endTime/label?`。
5. `classNames` 永不为空：常规课次至少一个班；合班/走班按成员展开全部班级；数据缺失时抛错，不伪造空数组。

### 3.4 五视图一致性证明

设方案 `P` 的全量课次为 `L(P)`。每个课次 `l` 有五元组身份：

```text
classKeys(l)   = l.lesson_class.class_id 集合
teacherKey(l)  = l.teacher_id
schoolKey(l)   = GLOBAL
venueKey(l)    = l.venue_id（可能为空）
unitKey(l)     = (l.unit_type, l.unit_id)
```

对任意维度 `d` 和对象 `o`，`query(d,o)` 返回 `{l ∈ L(P) | o ∈ key_d(l)}`；所有维度共享同一 `readPlanLessons(P)` 结果和同一字段映射。因此：

1. 同一 `lessonId` 在任意维度返回的字段完全相同（只做维度过滤，不做字段变换）。
2. 对维度 `d`，遍历其全部对象求并集，等于 `L(P)`（`VENUE` 维度中 `venue_id is null` 的课次除外，它们仍出现在其余维度）。
3. 对同一对象，`query(d,o)` 的 `lessonId` 集合与直接按 `key_d(l)=o` 过滤 `L(P)` 的集合完全相同。

### 3.5 教师数据范围

`TimetableViewQueryService` 在 SQL 之前先做范围判定：

| 请求 | `ADMIN` | `TEACHER` |
|------|---------|-----------|
| `SCHOOL` | 允许 | `403 FORBIDDEN` |
| `VENUE` | 允许 | `403 FORBIDDEN` |
| `ASSIGNMENT` | 允许 | `403 FORBIDDEN`（教师用 `/my/timetable`） |
| `TEACHER` | 任意教师 | 仅 `objectId=actor.teacherId`，否则 403 |
| `CLASS` | 任意班级 | 仅关联班级，否则 403 |

关联班级 = `teaching_assignment.class_id` ∪ `class.head_teacher_id=teacher` ∪ 合班/走班单元成员中该教师任教的班级（A-21）。服务端判定，前端隐藏不是安全边界。

## 4. IdleSlotQueryService

### 4.1 接口与输入

```ts
interface IdleSlotQuery {
  semesterId: string;
  planId?: string;
  dimension: 'TEACHER' | 'CLASS';
  objectId: string;
  parity: 'ALL' | 'ODD' | 'EVEN';
  actor: { userId: string; role: 'ADMIN' | 'TEACHER'; teacherId: string | null };
}

interface IdleSlotQueryService {
  query(input: IdleSlotQuery): Promise<IdleSlotView>;
}
```

- `/idle-slots?semesterId=&dimension=TEACHER|CLASS&objectId=&parity=`：管理员任意对象；教师只能 `dimension=TEACHER&objectId=本人`，否则 403。
- `/my/idle-slots?semesterId=&parity=`：对象固定本人；若带 `objectId` 且不等于本人，403；若带 `dimension=CLASS`，403。
- `planId` 可选，解析规则与课表完全一致。

### 4.2 互补算法

```text
openSlots       = template.openWeekdays × template.periods[].periodNo
occupiedCells   = expandParity(loadOccupancy(object))
openCells       = expandOpen(openSlots, parity)
idleCells       = openCells − occupiedCells
idleSlots       = collapseParity(idleCells)
```

`expandParity` 使用 §2.4 的规则；`collapseParity`：`{ODD,EVEN}→ALL`、`{ODD}→ODD`、`{EVEN}→EVEN`。

### 4.3 严格互补证明

对任意对象 `o` 和请求 `p`：

1. `openCells(p)` 由模板开放槽位按 `p` 展开，`occupiedCells(p)` 由同一课次集合按 `p` 展开。
2. `idleCells(p) = openCells(p) − occupiedCells(p)`，因此 `idleCells(p) ∩ occupiedCells(p) = ∅`。
3. 若课次占用了模板之外的槽位，数据非法；设计上 `occupiedCells(p) ⊆ openCells(p)`，否则返回 `409 STATE_CONFLICT` 并记录数据质量告警。
4. 因此 `occupiedCells(p) ∪ idleCells(p) = openCells(p)`，且 `collapseParity` 不改变槽位坐标集合，只合并周次标签。

与课表互补的口径：`parity=ODD` 时，空闲 ODD 槽位 = 模板 ODD 槽位 − 在 ODD 视图可见的占用；`EVEN` 同理；`ALL` 时按双周展开后合并标签。

## 5. 拖拽校验与整批调课

### 5.1 请求与响应

`moves/validate` 使用 `MoveBatchRequest`；`adjustments` 使用 `AdjustmentBatchRequest`（额外要求 `confirm`）。确认保存请求样例：

```json
{
  "version": 12,
  "unitId": "5a2f8e5d-4c1f-4ab7-9a7c-7f1d9a6e0b11",
  "confirm": true,
  "operations": [
    {
      "lessonId": "uuid",
      "from": { "weekday": 1, "period": 3 },
      "to": { "weekday": 2, "period": 3 },
      "venueId": "uuid",
      "weekParity": "ALL"
    }
  ]
}
```

- `moves/validate` 不含 `confirm`，零写入；合法返回 `{valid:true, conflicts:[]}`，冲突返回 `409 STATE_CONFLICT` + `details.conflicts`。
- `adjustments` 要求 `confirm===true`；缺失或 `false` 返回 `400 VALIDATION_ERROR`（`details.field='confirm'`），零写入。
- `undo/redo` 请求为 `{version, unitId}`；`unitId` 是客户端在确认保存时生成并复用的 UUID。

### 5.2 冲突校验

临时冲突不写入 `conflict_detail`。`conflictId` 使用 `UUIDv5(namespace, fingerprint)` 生成稳定值，`planId` 为当前方案，`resolution='UNRESOLVED'`，`ignorable=false`。

| 冲突 | 判定 | 中文提示示例 |
|------|------|--------------|
| `TEACHER_OVERLAP` | 同教师、同 `weekday/period`、周次展开相交 | 张老师在该节次已有课程，请调整 |
| `CLASS_OVERLAP` | 任一班级同槽位、周次相交 | 七年级（1）班在该节次已有课程 |
| `VENUE_OVERLAP` | 同场地、同槽位、周次相交 | 301 场地在该节次已被占用 |
| `LOCKED_VIOLATION` | 任一操作 `lesson.locked=true` | 课程已锁定，请先解锁 |
| `CAPACITY_EXCEEDED` | 目标场地容量 < 班级人数 | 目标场地容量不足 |
| `RULE_VIOLATION` | 目标槽位不在模板开放范围 | 该节次不在作息模板开放范围 |

周次相交规则：`ALL` 与任意相交；`ODD` 与 `ODD/ALL` 相交；`EVEN` 与 `EVEN/ALL` 相交；`ODD` 与 `EVEN` 不相交。

### 5.3 批量内冲突

校验必须基于「临时叠加」而不是逐条独立校验：

1. 从当前方案加载所有受影响课次与相关占用。
2. 先移除所有 `from` 位置的旧占用，再按批次顺序叠加所有 `to` 位置。
3. 同一批次内两个操作落到同一教师/班级/场地且周次相交，同样判定冲突。
4. 批量内同一 `lessonId` 重复出现、`from` 与当前课次不一致、目标槽位与 `from` 相同，均返回 `400 VALIDATION_ERROR`。

### 5.4 整批事务

`adjustments` 在一个事务内执行：

```text
BEGIN
  SELECT ... FROM timetable_plan WHERE plan_id=$1 FOR UPDATE
  校验方案属于未存档学期、状态 DRAFT/PUBLISHED、version=$version
  SELECT ... FROM lesson WHERE plan_id=$1 AND lesson_id IN (...) ORDER BY lesson_id FOR UPDATE
  校验锁定、from 一致、目标槽位合法、容量
  构建临时占用叠加并校验教师/班级/场地冲突（含批内）
  任一失败：ROLLBACK，返回 409/400，零写入
  UPDATE lesson SET weekday/period/venue_id/week_parity WHERE lesson_id=...
  UPDATE timetable_plan SET version=version+1
  INSERT adjustment_history(action='APPLY', operations=$ops, version_before/after)
  INSERT operation_log(module='ADJUST', action='SAVE_ADJUSTMENT', target_type='TIMETABLE_PLAN', target_id=planId)
  INSERT sys_outbox_event('bc.timetable.lesson.moved') 每课次一条
COMMIT
```

`operation_log.content` 至少包含 `planId`、`semesterId`、`unitId`、`lessonCount`、`from→to` 摘要；日志与业务写入同事务。

### 5.5 零写入证明

- `moves/validate` 不进入写事务，不写 `lesson`、`timetable_plan`、`adjustment_history`、`operation_log`、`sys_outbox_event`。
- `adjustments` 的冲突校验在任何 `UPDATE/INSERT` 之前完成；任一冲突直接 `ROLLBACK`。
- 数据库唯一索引与版本守卫作为第二道防线；即使应用层漏判，事务也整体回滚。

## 6. 撤销/重做

### 6.1 客户端撤销栈

```ts
interface EditUnit {
  unitId: string;
  action: 'APPLY';
  operations: MoveOperation[];
  versionBefore: number;
  versionAfter: number;
}

interface EditSession {
  planId: string;
  undoStack: EditUnit[];   // 最新在末尾
  redoStack: EditUnit[];
}
```

- 一次确认保存产生一个 `EditUnit`，多个移动作为一个单元。
- 成功保存后：`undoStack.push(unit)`，清空 `redoStack`。
- 撤销成功：从 `undoStack.pop()`，压入 `redoStack`；重做成功反向操作。
- 栈上限 50：超过时丢弃最旧单元（`shift`），UI 在栈空时禁用按钮。
- 离开方案、刷新页面、切换方案或会话失效：清空两个栈；服务端历史保留但不主动提供跨会话撤销。
- 服务端以 `(plan_id, operator_id, session_id, unit_id)` 定位历史；客户端无法撤销他人或其他会话的单元。

### 6.2 服务端重放

`undo`：

1. 加载方案并校验版本、未存档。
2. 读取该 `unitId` 在本会话的最新历史记录。
3. 若最新 `action` 不是 `APPLY` 或 `REDO`，返回 `409 STATE_CONFLICT`（不可撤销）。
4. 取该记录的 `operations`，生成逆操作：交换 `from/to`，保留 `venueId/weekParity` 的原值语义。
5. 用 §5.2/§5.3 重新校验逆操作；失败整组拒绝。
6. 应用逆操作，`version+1`，写 `adjustment_history(action='UNDO')`、`operation_log(action='UNDO_ADJUSTMENT')`；不写 `lesson.moved` 事件。

`redo`：

1. 加载方案并校验版本、未存档。
2. 读取该 `unitId` 在本会话的最新历史记录。
3. 若最新 `action` 不是 `UNDO`，返回 `409 STATE_CONFLICT`（不可重做）。
4. 取该 `UNDO` 记录的 `operations`，生成正向操作：再次交换 `from/to`。
5. 重新校验并应用，`version+1`，写 `adjustment_history(action='REDO')`、`operation_log(action='REDO_ADJUSTMENT')`；不写 `lesson.moved` 事件。

### 6.3 历史与版本

| 事件 | `adjustment_history.action` | `version_before → version_after` | `operation_log.action` | 事件 |
|------|------------------------------|-----------------------------------|------------------------|------|
| 确认保存 | `APPLY` | `v → v+1` | `SAVE_ADJUSTMENT` | 每课次 `bc.timetable.lesson.moved` |
| 撤销 | `UNDO` | `v → v+1` | `UNDO_ADJUSTMENT` | 无 |
| 重做 | `REDO` | `v → v+1` | `REDO_ADJUSTMENT` | 无 |

`version_before/after` 用于重放时校验；任一版本不匹配返回 `409 VERSION_CONFLICT`。

### 6.4 边界说明

| 场景 | 行为 |
|------|------|
| 离开方案 / 刷新 | 客户端栈清空；服务端历史保留；再次进入不能撤销旧单元 |
| 栈超过 50 | 丢弃最旧单元；UI 禁用不可用方向 |
| 撤销已撤销单元 | 409 `STATE_CONFLICT` |
| 重做未撤销单元 | 409 `STATE_CONFLICT` |
| 锁定课次被撤销/重做 | 409 `STATE_CONFLICT`，整组零写入 |
| 存档学期撤销/重做 | 409 `STATE_CONFLICT`，整组零写入 |
| 多人并发修改 | 版本不匹配 409 `VERSION_CONFLICT`，刷新后重新构建栈 |
| 历史中的课次已删除 | 409 `STATE_CONFLICT`，不部分应用 |
| 重放产生新冲突 | 409 `STATE_CONFLICT`，不部分应用 |

## 7. 前端交互契约

### 7.1 TimetableGrid

```ts
interface TimetableGridProps {
  view: TimetableView;
  editable: boolean;          // 仅 ADMIN 的调课页为 true
  conflictSlots?: Slot[];     // 红色高亮
  busy?: boolean;
}

interface TimetableGridEmits {
  (e: 'lesson-drop', payload: {
    lessonId: string;
    from: Slot;
    to: Slot;
    venueId: string | null;
    weekParity: WeekParity;
  }): void;
  (e: 'lesson-click', lessonId: string): void;
}
```

- 维度 Tab：`班级 / 教师 / 全校 / 场地 / 任课`；教师只渲染 `我的课表` / `我的班级` 入口。
- 课程块必须显示：科目、教师、班级（合班/走班显示全部班级）、场地；锁定课次显示锁图标。
- `ALL` 视图按 `weekParity` 显示 `单周/双周/每周` 标签；`ODD/EVEN` 视图只显示对应可渲染课次。
- 网格坐标来自响应 `weekdays/periods`，前端不得自行聚合或重排课次。

### 7.2 拖拽与冲突

1. `dragstart` 只允许 `editable=true` 且 `lesson.locked=false` 的课程块。
2. `drop` 先本地检查目标槽位；随后调用 `POST moves/validate`。
3. 返回 `valid=false` 或 HTTP 409：目标槽位红色高亮，Toast 显示中文冲突文案，课程块回弹到原位置；不写入任何数据。
4. 返回 `valid=true`：课程块临时落位，进入待保存状态；不调用保存接口。
5. 多选拖拽/批量移动：所有移动累积为一个待保存单元，`unitId` 在首次落位时生成。
6. 网络错误：回弹并显示「校验失败，请稍后重试」；不得乐观写入。

### 7.3 二次确认与保存

- 点击「保存调课」先打开确认对话框，展示：方案名、学期、移动课次数、涉及班级/教师/场地。
- 取消：关闭对话框，零写入，待保存状态保留。
- 确认：调用 `POST adjustments`，请求必须带 `confirm=true`、当前 `version`、`unitId`、完整 `operations`。
- 成功：使用响应 `version` 更新本地版本，清空待保存状态，压入撤销栈；显示「调课已保存」。
- 409：显示冲突明细，保留待保存状态或回弹，刷新版本；不得部分应用。
- 400 `confirm`：视为客户端缺陷，提示「请确认后重试」并零写入。

### 7.4 撤销/重做按钮

- 工具栏显示「撤销」「重做」；栈空或 `busy` 时禁用。
- 快捷键 `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` 与按钮同源调用。
- 撤销/重做前也调用二次确认（批量单元影响多课次时）；取消零写入。
- 成功后刷新当前视图，保持维度与对象不变；失败显示中文原因，不改变本地栈。

### 7.5 空闲页与教师个人视图

- 空闲页：对象类型（教师/班级）→ 对象 → 周次（ALL/ODD/EVEN）→ 网格高亮空闲槽位；空闲槽位用绿色/浅色底，已占用槽位不在空闲集合中。
- 教师个人视图：`/me/timetable` 仅显示本人教师视图；`/my/classes` 显示关联班级列表并可切换；`/me/idle-slots` 对象固定本人。
- 教师导航仅保留「我的课表」「我的空闲时段」「退出登录」；不渲染管理入口（A-22/roles §5）。
- 管理员导航保留五视图、调课、空闲查询；切换学期后所有页面重新请求，清空本地待保存与撤销栈。

## 8. 响应样例

### 8.1 五视图样例

共同输入：学期 `sem-1`，方案 `plan-1`，模板开放星期 `[1,2,3]`，节次 `[1,2,3]`。课次：

| 课次 | 槽位 | 周次 | 科目 | 教师 | 班级 | 场地 | 单元 |
|------|------|------|------|------|------|------|------|
| L1 | Mon 1 | ALL | 数学 | 张老师 | 701 | 301 | ASSIGNMENT/A1 |
| L2 | Tue 2 | ODD | 英语 | 李老师 | 701,702 | 302 | COMBINED_CLASS/C1 |
| L3 | Wed 3 | EVEN | 物理 | 王老师 | 703 | null | ASSIGNMENT/A2 |

班级视图 `dimension=CLASS&objectId=701`：

```json
{
  "data": {
    "semesterId": "sem-1",
    "dimension": "CLASS",
    "objectId": "701",
    "parity": "ALL",
    "weekdays": [1, 2, 3],
    "periods": [
      { "periodNo": 1, "startTime": "08:00", "endTime": "08:45" },
      { "periodNo": 2, "startTime": "08:55", "endTime": "09:40" },
      { "periodNo": 3, "startTime": "10:00", "endTime": "10:45" }
    ],
    "cells": [
      { "weekday": 1, "period": 1, "lessonId": "L1", "subjectName": "数学", "teacherName": "张老师", "classNames": ["701"], "venueName": "301", "weekParity": "ALL", "locked": false },
      { "weekday": 2, "period": 2, "lessonId": "L2", "subjectName": "英语", "teacherName": "李老师", "classNames": ["701", "702"], "venueName": "302", "weekParity": "ODD", "locked": false }
    ]
  }
}
```

教师视图 `dimension=TEACHER&objectId=张老师`：`cells=[L1]`，字段与上例 L1 完全一致。

全校视图 `dimension=SCHOOL`：`cells=[L1,L2,L3]`，`objectId` 省略，字段与上例一致。

场地视图 `dimension=VENUE&objectId=301`：`cells=[L1]`；`venueId=null` 的 L3 不出现在任何场地视图。

任课视图 `dimension=ASSIGNMENT&objectId=A1&unitType=ASSIGNMENT`：`cells=[L1]`；合班单元用 `objectId=C1&unitType=COMBINED_CLASS` 返回 `cells=[L2]`。

五视图一致性：`L1` 在班级/教师/全校/场地/任课五个视图的字段完全相同；`L2` 在班级/全校/任课（合班）视图一致；`L3` 在班级/全校/任课视图一致。

### 8.2 空闲样例

教师李老师，`parity=ALL`：开放槽位 9 个，`L2` 占用 `(Tue,2,ODD)`。

```json
{
  "data": {
    "semesterId": "sem-1",
    "objectType": "TEACHER",
    "objectId": "李老师",
    "parity": "ALL",
    "slots": [
      { "weekday": 1, "period": 1, "weekParity": "ALL" },
      { "weekday": 1, "period": 2, "weekParity": "ALL" },
      { "weekday": 1, "period": 3, "weekParity": "ALL" },
      { "weekday": 2, "period": 1, "weekParity": "ALL" },
      { "weekday": 2, "period": 2, "weekParity": "EVEN" },
      { "weekday": 2, "period": 3, "weekParity": "ALL" },
      { "weekday": 3, "period": 1, "weekParity": "ALL" },
      { "weekday": 3, "period": 2, "weekParity": "ALL" },
      { "weekday": 3, "period": 3, "weekParity": "ALL" }
    ]
  }
}
```

`parity=ODD` 时 `slots` 为 8 个 `ODD`；`parity=EVEN` 时 `slots` 为 9 个 `EVEN`。

### 8.3 调课校验样例

```json
{
  "data": {
    "valid": false,
    "conflicts": [
      {
        "conflictId": "0f0d6a9a-6f4b-5b8a-9f7e-2d3e4c5b6a71",
        "planId": "plan-1",
        "lessonId": "L1",
        "conflictType": "TEACHER_OVERLAP",
        "teacherId": "张老师",
        "classIds": ["701"],
        "venueId": "301",
        "weekday": 2,
        "period": 3,
        "weekParity": "ALL",
        "ruleId": null,
        "configRef": null,
        "suggestion": "张老师在该节次已有课程，请调整",
        "ignorable": false,
        "ignoreBlockedReason": "核心冲突不可忽略",
        "resolution": "UNRESOLVED"
      }
    ]
  }
}
```

HTTP 状态为 `409 STATE_CONFLICT`；前端红色高亮 `(Tue,3)` 并回弹。

### 8.4 调课成功与撤销/重做样例

```json
{
  "data": {
    "planId": "plan-1",
    "version": 13,
    "historyId": "hist-3",
    "action": "APPLY",
    "conflictCount": 0
  }
}
```

连续三次保存后 `version=13`，`undoStack=[U1,U2,U3]`；撤销三次后 `version=16`，`redoStack=[U3,U2,U1]`；重做三次后 `version=19`，`undoStack=[U1,U2,U3]`。每步课表与对应历史单元一致。

## 9. 验证矩阵

| 编号 | 断言 | 设计证据 | 静态/执行检查 |
|------|------|----------|---------------|
| D06-01 | 五视图切换且字段完整 | §3.2-§3.4；§8.1 | `timetable-view-design.test.ts` 五维 fixture |
| D06-02 | 同一数据跨视图 lessonId 集合一致 | §3.4 | 同上 |
| D06-03 | 空闲与课表严格互补 | §4.2-§4.3 | 同一测试的 complement 参考实现 |
| D06-04 | 学期隔离 | §2.3、§3.5、§5.4 | 契约与设计文本断言 |
| D06-05 | 教师范围与 403 | §3.5、roles §3 | 契约角色与设计文本断言 |
| D06-06 | 冲突不落库、零写入 | §5.2-§5.5 | 事务顺序与零写入文本断言 |
| D06-07 | 批量调课整批事务 | §5.4-§5.5 | 事务步骤断言 |
| D06-08 | 撤销/重做逆序/原序、上限 50、离开清空 | §6.1-§6.4 | undo/redo 参考实现 |
| D06-09 | 保存二次确认、未确认零写入 | §5.1、§7.3 | `confirm` 契约断言 |
| D06-10 | ALL/ODD/EVEN 正确 | §2.4、§7.1 | parity 参考实现 |
| D06-11 | 锁定课次移动 409 | §5.2、§6.4 | 设计/契约文本断言 |
| D06-12 | 调整历史/日志/事件同事务 | §5.4、§6.3 | 设计/契约文本断言 |

## 10. 契约修正与待实现项

1. `/timetables` 与 `/idle-slots` 的 `x-required-roles` 增补 `TEACHER`，由服务端数据范围过滤；导航仍按 `roles.md` §5 仅对管理员展示管理入口。
2. `/timetables` 增加可选 `planId` 与 `unitType`；`planId` 用于调课页锁定方案，`unitType` 仅 `ASSIGNMENT` 维度必填。
3. `/idle-slots` 增加可选 `planId`，与课表使用同一方案解析。
4. `AdjustmentBatchRequest` 增加必填 `confirm: boolean`；服务端要求 `true`，未确认零写入。
5. `0022_timetable_adjustment_indexes.sql` 只补索引；`contracts/schema.sql` 同步索引，避免契约与迁移草案漂移。
6. 实现轮次必须补：`TimetableViewQueryService`、`IdleSlotQueryService`、调课应用服务、Vue `TimetableGrid` 与空闲页。
7. D02/D03 查询服务落地后，才能执行五视图与空闲的运行时集成测试；本轮只做设计/静态验证。

## 11. 验收结论口径

设计态可以证明：五视图共享同一读取路径、空闲与占用严格互补、调课整批事务与零写入边界可表达、撤销/重做按确认保存单元重放且可重校验、单双周展开规则一致。不能声称 API、数据库事务或 E2E 已执行通过。实现轮次必须以 §9 为验收入口，先完成五视图/空闲互补，再执行冲突零写入、整批事务、撤销/重做序列、权限与学期隔离回归。
