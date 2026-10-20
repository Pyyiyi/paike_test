# D05 排课引擎、方案生命周期与冲突处置设计

> 状态：设计态。本文定义排课快照、约束、确定性算法、表、生命周期、API 与 D15 断言；不包含业务实现、页面实现或已执行测试结果。
> 权威输入：PRD F8/F9/F17、附件 A、D12-D15、D19、D21、R-018~R-021、R-034、A-09~A-19、H-01、H-03、H-05、`p2-contracts.md` §3。

## 1. 范围、依赖与不变量

### 1.1 范围

- 排课输入快照读取器：只调用 registry/resource QueryService，不读取、不写入其私有表。
- `ConflictValidationService`：H1-H12 硬约束、S1-S6 软约束与冲突明细。
- `TimetableEngineService`：MRV、稳定槽位排序、有界回溯、超时与部分结果。
- `TimetablePlanLifecycle`：新建、生成、另存、重命名、删除、发布、覆盖、存档联动与并发版本。
- `LessonLockState`：预排、锁定、解锁与生成保留。
- 冲突中心、未排课时清单、「只本次忽略」与「去修改配置」。
- `/scheduling`、`/scheduling/pre`、`/conflicts` 的交互设计。
- D15 固定锚点测试装置、三类核心冲突断言、连续三次一致性与 50 班性能基准。

### 1.2 非范围

- 不实现 D06 的五视图、拖拽调课、撤销/重做和空闲查询；D05 只创建 `adjustment_history` 并定义锁定/版本接口。
- 不实现 D07 的学期存档编排；D05 提供方案生命周期原语与存档后的写守卫。
- 不实现 D02/D03 的主数据 CRUD；D05 依赖其只读 QueryService。
- 本轮不把设计迁移草案放入 `migrations/`，也不实现业务 API、Vue 页面或引擎代码。

### 1.3 依赖状态

| 依赖 | 当前基线 | D05 使用方式 |
|------|----------|--------------|
| D01 学期/模板/校历 | 已实现 QueryService | 学期、钉扎模板版本、教学周与停课/调休 |
| D02 班级/科目规则 | 设计态，尚无 QueryService | D05 定义最小快照接口；实现前必须由 D02 导出 |
| D03 教师/任课 | 设计态，已有接口设计、尚无实现 | 使用 `TeacherQueryService` / `AssignmentQueryService`；实现前必须由 D03 导出 |
| D04 场地/合班/走班 | 已实现 QueryService | `VenueQueryService` 与 `SchedulingUnitQueryService` |
| D07 操作日志 | 设计态 | D05 的生成/发布/忽略/锁定在同一业务事务调用共享 `writeOperationLog` |
| P0-01 outbox | 已实现 | 同一事务 `appendEvent` |

> D15 的业务执行必须等 D02/D03 的查询服务落地；本轮只完成设计资产和静态验证，不声称 D15 已执行。

### 1.4 强制不变量

1. 自动生成的已放置课次必须满足 H1-H12；不得以“凑满课时”为由制造冲突。
2. 三类核心冲突 `TEACHER_OVERLAP`、`CLASS_OVERLAP`、`VENUE_OVERLAP` 在合法生成结果中为 0；只要有 1 条未解决核心冲突，方案不得发布。
3. 同一学期至多一个 `PUBLISHED`；覆盖发布在同一事务内完成旧 `PUBLISHED -> SUPERSEDED` 与新 `DRAFT -> PUBLISHED`。
4. 已存档学期的生成、发布、覆盖、调课、锁定、忽略、另存和草稿变更全部返回 `409 STATE_CONFLICT`，零写入。
5. 锁定课次不得移动、删除或被生成覆盖；`preserveLocked=false` 且存在锁定课次时拒绝生成，而不是悄悄丢弃锁。
6. 「只本次忽略」只改变当前 `generation_no` 的冲突处理状态，并追加 `conflict_ignore` 与操作日志；不修改 registry/resource 配置。
7. 容量超限、锁定违规、已存档冲突不提供忽略入口。
8. 同一输入、模板版本、锁定集合、代码版本连续生成 3 次，课表格子、未排原因和冲突签名完全一致。
9. D15 附件 A 是唯一公共期望表；算法、测试和实现不得为 D15 写特例分支。
10. 生成快照只读；生成事务不得写 `registry` / `resource` 表。

## 2. 数据模型

### 2.1 迁移草案

| 迁移 | 内容 | 设计文件 |
|------|------|----------|
| `0020_timetable_plan.sql` | 枚举、`timetable_plan`、唯一正式索引、方案生成追踪字段 | `docs/knowledge/designs/0020_timetable_plan.sql` |
| `0021_timetable_lesson_conflict.sql` | `lesson`、`lesson_class`、`unscheduled_lesson`、`conflict_detail`、`conflict_ignore`、`adjustment_history` | `docs/knowledge/designs/0021_timetable_lesson_conflict.sql` |

### 2.2 TimetablePlan

| 字段 | 规则 |
|------|------|
| `plan_id` | UUID；方案聚合根 |
| `semester_id` | 必填；学期必须存在且未存档 |
| `schedule_template_version_id` | 必须等于 `semester.schedule_template_version_id`；生成时再次固定 |
| `source_plan_id` | 另存来源；只用于追踪，源方案不被修改 |
| `name` | 去空格非空；另存时必填新名称 |
| `status` | `DRAFT / PUBLISHED / SUPERSEDED / ARCHIVED` |
| `version` | H-01 乐观锁；所有写命令携带期望值，成功写 `+1` |
| `generation_no` | 每次生成/重新生成 `+1`；冲突与忽略审计按运行绑定 |
| `generation_seed` | 由学期、模板版本、引擎版本派生的固定大整数 |
| `snapshot_hash` | 规范化输入快照 SHA-256；用于复现；不落配置表 |
| `conflict_count` | 仅统计 `resolution='UNRESOLVED'` 的冲突 |
| `unscheduled_count` | 未排清单行数 |
| `duration_ms` | 引擎 `performance.now()` 单调耗时；与响应同值 |
| `has_manual_exemption` | 当前运行存在 `IGNORED_ONCE` 时为 true |
| `generated_at/by` | 最近一次成功生成 |
| `published_at/by` | 最近一次发布 |
| `superseded_at` | 被新正式方案覆盖的时间 |
| `archived_at` | D07 学期存档联动时间 |
| `deleted_at` | 仅 DRAFT 允许逻辑删除 |

唯一性：`uq_plan_one_published (semester_id) WHERE status='PUBLISHED' AND deleted_at IS NULL`。

### 2.3 Lesson / LessonClass

- `lesson` 是一节具体课次，不是任课需求。一个 `weekly_periods=2` 的任课单元产生 2 行 `lesson`。
- `unit_type + unit_id` 指向 `ASSIGNMENT`、`COMBINED_CLASS` 或 `WALKING_GROUP`。
- `class_ids` 规范化到 `lesson_class`；任何一个参与班级都参与 H2。
- `week_parity` 默认 `ALL`；预排接口可创建 `ODD/EVEN`。
- `locked=true` 时 `locked_at/locked_by` 必须同时存在；锁定状态只能经 lock/unlock 命令变更。
- 同一 `(plan, unit, weekday, period, parity)` 只允许一行，避免重复课次。
- `venue_id=NULL` 表示使用班级归属普通教室：不参与共享场地占用，也不触发共享场地容量校验；D15 的数学课即此语义。

### 2.4 UnscheduledLesson

- 一个无法完全排入的排课单元一行；`required_periods` 为该运行总需求，`unplaced_periods` 为未排数量。
- `class_ids` 非空并按 UUID 字典序持久化。
- `reason_code` 只能取七值；`reason_detail` 必须能让人理解是教师、班级、场地、容量、锁定还是超时。
- `suggested_actions` 至少一项，结构为 `{ label, route, configRef }`；`source_config_refs` 保存所有可归因配置。
- 未排清单与 `conflict_count` 分开展示，绝不把未排伪装成 0 冲突。

### 2.5 ConflictDetail / ConflictIgnore

- `conflict_detail` 只保存一次 `generation_no` 的持久化发现；被拒绝的调课请求返回临时冲突，不落库。
- `fingerprint = SHA-256(conflictType | sorted objectIds | weekday | period | parity | ruleId | canonical configRef)`，同一运行稳定去重。
- `week_parity` 参与冲突判定：`ALL` 与任意周次冲突，`ODD` 与 `EVEN` 不冲突。
- `ignorable` 由服务端计算；`ignore_blocked_reason` 在不可忽略时返回中文原因。
- `conflict_ignore` 是追加写审计，故意不对 `conflict_id` 设外键：重新生成删除旧冲突时，审计仍保留冲突指纹、类型、对象快照、规则和配置引用。
- `scope` 恒为 `THIS_RUN`；每次忽略必须二次确认并填写原因。

### 2.6 AdjustmentHistory

D05 建表，D06 使用。一次确认保存的批量移动为一个 `unit_id`；`operations` 是完整操作数组，`version_before/after` 支持按会话重放时做版本校验。历史与业务写入同事务，撤销/重做不得部分应用。

## 3. 输入快照读取器

### 3.1 最小查询接口

```ts
interface TimetableSnapshotReader {
  load(input: {
    semesterId: string;
    planId: string;
    expectedPlanVersion: number;
    preserveLocked: boolean;
  }): Promise<TimetableInputSnapshot>;
}

interface ClassSnapshot {
  classId: string;
  className: string;
  gradeId: string;
  gradeName: string;
  studentCount: number;
  version: number;
}

interface SubjectRuleSnapshot {
  subjectId: string;
  subjectName: string;
  weeklyPeriods: number;
  consecutivePreference: 'NONE' | 'PREFERRED' | 'REQUIRED';
  forbiddenSlots: Slot[];
  fixedSlots: Slot[];          // H10；D02 必须补充该字段
  timeSlotPreference: 'NONE' | 'MORNING' | 'AFTERNOON';
  periodBalanceEnabled: boolean;
  amPmBalanceEnabled: boolean;
  fixedSlotRuleEnabled: boolean;
  version: number;
}

interface ClassQueryService {
  listSchedulingClasses(): Promise<ClassSnapshot[]>;
}

interface SubjectQueryService {
  listSchedulingSubjects(): Promise<SubjectRuleSnapshot[]>;
}
```

D01/D03/D04 使用已定义接口：`SemesterQueryService`、`TemplateQueryService`、`CalendarQueryService`、`TeacherQueryService`、`AssignmentQueryService`、`VenueQueryService`、`SchedulingUnitQueryService`。

### 3.2 TimetableInputSnapshot

```ts
interface TimetableInputSnapshot {
  semester: SemesterSnapshot;
  templateVersion: TemplateVersionSnapshot;
  academicCalendar: AcademicWeek[];
  classes: ClassSnapshot[];
  subjects: SubjectRuleSnapshot[];
  teachers: TeacherSnapshot[];
  assignments: TeachingAssignmentSnapshot[];
  venues: VenueSnapshot[];
  units: SchedulingUnitSnapshot[];
  lockedLessons: LessonSnapshot[];
  seed: bigint;
  snapshotHash: string;
}
```

### 3.3 读取规则

1. 在只读 `REPEATABLE READ` 事务中一次性读取所有跨域快照，读到后深冻结；生成事务不得再次回查主数据。
2. 输入数组按业务键稳定排序：班级 `classId`、科目 `subjectId`、教师 `teacherId`、任课 `assignmentId`、场地 `venueId`、单元 `unitType, unitId`、锁定课次 `weekday, period, lessonId`。
3. `Slot` 统一按 `(weekday, period)` 去重升序；`forbidden_slots`、`exempted_slots`、`fixed_slots` 分开保存语义，不合并。
4. 只纳入 `deleted_at IS NULL`、教师 `ACTIVE`、场地 `AVAILABLE`、学期未存档的数据。
5. 任课是周课时权威来源；`SubjectRuleSnapshot.weeklyPeriods` 用于规则一致性和展示，不覆盖任课周课时。
6. 连堂偏好优先级：任课 `REQUIRED/PREFERRED` > 科目规则；任课 `NONE` 时才继承科目规则。
7. 快照不落库；只把 `schedule_template_version_id`、`generation_seed`、`snapshot_hash` 与生成结果落库。
8. 学期模板版本与方案字段不一致时直接 `409 STATE_CONFLICT`，不自动改钉扎版本。

### 3.4 固定种子

```text
seedMaterial = "paike-scheduler-v1\0" + semesterId + "\0" + templateVersionId + "\0" + engineVersion
seed = BigInt("0x" + sha256(seedMaterial).slice(0, 15))   // 60-bit，安全落入 bigint
```

引擎不调用 `Math.random`、数据库随机排序或时间相关排序。`TimetableEngineService.run(snapshot, { seed })` 在应用服务内接受 seed：生产固定传入派生值，测试可传固定常量；公共 API 不接受客户端 seed。种子只用于追踪和稳定哈希空间，不进行随机重启；所有实际顺序由下文的稳定比较器决定。

## 4. 约束与冲突

### 4.1 硬约束

| 编号 | 可执行定义 | 违反结果 |
|------|------------|----------|
| H1 | 同一教师 `(weekday,period)` 的周次集合相交即禁放；`ALL` 与任意相交，`ODD` 与 `EVEN` 不相交 | `TEACHER_OVERLAP`；不可忽略除非可归因规则并显式忽略 |
| H2 | 同一班级、任一参与班级的 `(weekday,period,parity)` 相交即禁放 | `CLASS_OVERLAP` |
| H3 | 同一非空场地 `(weekday,period,parity)` 相交即禁放；`venueId=NULL` 不占共享场地 | `VENUE_OVERLAP` |
| H4 | 班级人数 ≤ 指定场地容量；未指定场地按班级归属普通教室处理 | `CAPACITY_EXCEEDED`，不可忽略 |
| H5 | 教师任课 `forbiddenSlots` / `exemptedSlots` 命中的槽位禁放；分别保留来源 | `RULE_VIOLATION` |
| H6 | 科目 `forbiddenSlots` 命中的槽位禁放 | `RULE_VIOLATION` |
| H7 | 锁定课次是固定锚点，不移动、不删除、不覆盖 | `LOCKED_VIOLATION`，不可忽略 |
| H8 | 合班/走班单元同时占教师、目标场地、全部参与班级；单元内不拆班 | 根据冲突维度输出 H1/H2/H3 |
| H9 | 每个任课/单元在本次运行内必须尝试排满 `weeklyPeriods`；无法排满进入未排清单 | `unplaced_periods > 0` |
| H10 | `fixedSlotRuleEnabled=true` 时，科目只能落在 `fixedSlots` 中的槽位 | `RULE_VIOLATION` |
| H11 | 只能落在模板 `openWeekdays` 与存在的 `periodNo` 内，且 `period <= 20` | 候选域直接过滤；无候选进入未排 |
| H12 | 学期 `status=ARCHIVED` 时禁止生成/调课/发布/锁定/忽略/另存 | API `409 STATE_CONFLICT`，零写入 |

> H10 的 `fixedSlots` 是既有 D02 契约缺口；D05 同步补充字段，D02 实现必须返回该字段。无固定时段规则时值为空数组。

### 4.2 软约束与确定性评分

硬约束先过滤，候选按以下**字典序**比较，不使用浮点随机权重：

| 顺序 | 评分 | 规则 |
|------|------|------|
| 1 | 连堂惩罚 | `REQUIRED` 作为硬块；`PREFERRED` 不成块最差，其次是间隔 |
| 2 | 科目跨班对齐 | 非连堂且同科目已有其他班级课次时，优先相同 `period`、不同日 |
| 3 | 同日分散 | 同单元/同班同科目同日课次越少越好 |
| 4 | S2 时段偏好 | 开启且 `MORNING/AFTERNOON` 命中为 0，否则 1 |
| 5 | S3 课时均衡 | 开启时，同班同科目相邻/堆叠惩罚 |
| 6 | S4 上下午均衡 | 开启时，同班/教师当日上下午课次差惩罚 |
| 7 | S6 节次靠前 | 同一 weekday 内 period 越小越好 |
| 8 | 稳定位置 | `weekday` 升序，再 `period` 升序 |

`S1 REQUIRED` 优先于一切软分；`S5` 由第 2、3 项实现并默认开启；`S6` 是最终稳定 tie-break。所有比较器都以 UUID 字典序作为最后决胜，确保不同数据库返回顺序不影响结果。

该通用评分自然复现 D15：A 数学连续块取周一 1-2；A 英语在 A 数学后取可行的周一第 3 节；B 数学跨班对齐第 1 节并在次日分散后取周一、周三第 1 节；B 英语对齐英语第 3 节并避开已被 301 占用的周一第 3 节，取周二第 3 节。代码中不得出现 D15 常量或期望表分支。

### 4.3 冲突类型与可否忽略

| 类型 | 产生场景 | 可忽略 |
|------|----------|:------:|
| `TEACHER_OVERLAP` | H1；通常来自人工锁定的异常组合 | 仅当 `ruleId + configRef` 可归因 |
| `CLASS_OVERLAP` | H2；合班/走班任一参与班级冲突 | 仅当可归因 |
| `VENUE_OVERLAP` | H3；功能室/场地占用 | 仅当可归因 |
| `CAPACITY_EXCEEDED` | H4 | 否 |
| `LOCKED_VIOLATION` | H7 移动/覆盖锁定课次 | 否 |
| `RULE_VIOLATION` | H5/H6/H10/H11 等可配置规则 | 仅当 `ruleId + configRef` 可归因 |

不可忽略的稳定判定：`ignorable = resolution=UNRESOLVED && ruleId!=null && configRef!=null && conflictType NOT IN ('CAPACITY_EXCEEDED','LOCKED_VIOLATION') && semester.status != 'ARCHIVED'`。已存档学期根本没有忽略端点写入，API 返回 409。

## 5. 确定性调度器

### 5.1 需求与变量

- `LessonDemand`：一次需要占据一个槽位的课次；其键为 `unitType, unitId, occurrenceNo`。
- `DemandBlock`：`REQUIRED` 连堂的一个原子变量，包含连续的 2 个或多个 occurrence；整块同时放置。
- 锁定课次先转为 `Anchor`，从对应单元的需求数中扣除；锁定的 occurrence 不参与移动搜索。
- 变量集合 = 锁定锚点之外的所有 `LessonDemand` / `DemandBlock`。

### 5.2 静态优先级

稳定排序键：

1. 锁定锚点（先校验，不参与分配）；
2. `COMBINED_CLASS` / `WALKING_GROUP`；
3. `REQUIRED` 连堂；
4. 禁排/免排约束数量降序；
5. `weeklyPeriods` 降序；
6. `unitType` 字典序；
7. `unitId` 字典序；
8. `occurrenceNo` 升序。

### 5.3 MRV 与槽位排序

```text
while unplaced variables exist:
  for each variable compute domain = feasible candidate assignments under current state
  choose variable with smallest domain size
  tie-break by static priority, then variableKey
  order candidates by candidateKey (section 4.2)
  try candidates in order with bounded DFS
```

- 域只包含 H1-H12 与锁定锚点过滤后的候选；`REQUIRED` 变量域由连续块组成。
- 候选分数和变量顺序都不依赖数组插入顺序、当前日期、UUID 随机值或数据库物理顺序。
- 每次尝试前推进全局步数；每次回退计入对应单元的回退计数。

### 5.4 有界回溯与部分结果

```text
perUnitBacktracks[unitId] += 1 on undo
if perUnitBacktracks[unitId] > 200:
  stop expanding that unit; mark remaining demand unplaced; continue with next variable
if totalBacktrackSteps > 200000 or elapsed > 4500ms:
  stop search; return current best incumbent
```

- 单单元回退上限 200；全局安全上限 200000 步；软时间预算 4500ms，为 IO 留 500ms。
- 先执行一次确定性贪心构造 incumbent；回溯只能改善 incumbent，不能随机重启。
- 超时不是失败异常：已放置课次保留，未放置进入清单，原因 `TIME_LIMIT`。
- 任何路径都不能通过制造冲突来增加已放置数。

### 5.5 生成事务

1. 读取方案并校验状态、版本、学期未存档、模板钉扎一致。
2. 通过 `TimetableSnapshotReader` 取得只读快照；计算 seed、snapshotHash。
3. 在内存中运行引擎，产出 lessons、conflicts、unscheduled 与统计。
4. 开启写事务；用 `UPDATE timetable_plan SET version=version+1, ... WHERE plan_id=? AND version=?` 做 H-01 守卫。
5. 先删旧 `conflict_detail` / `unscheduled_lesson`，再删未锁定 `lesson`/`lesson_class`；锁定课次原样保留。
6. 写入本次结果、统计、`generation_no+1`、`duration_ms`、`generated_at/by`。
7. 同一事务写 `operation_log`、`bc.timetable.plan.generated` outbox；提交。

失败任一步全部回滚；版本不一致返回 `409 VERSION_CONFLICT`，不写日志或 outbox。

## 6. 未排课时、冲突与忽略

### 6.1 未排原因优先级

| 优先级 | 原因码 | 判定 | 建议跳转 |
|:---:|--------|------|----------|
| 1 | `TIME_LIMIT` | 时间/全局步数触发，仍有域未搜索完 | 冲突中心重试；检查约束数量 |
| 2 | `CAPACITY` | 所有候选因 H4 容量失败 | `/venues/{venueId}` 修改容量或换场地 |
| 3 | `LOCK_CONFLICT` | 锁定锚点占满该单元仅存可行域 | `/scheduling/pre?planId=&lessonId=` 解锁/调整 |
| 4 | `TEACHER_EXHAUSTED` | 教师占用/禁排/免排是共同瓶颈 | `/teachers/{teacherId}/assignments` |
| 5 | `CLASS_EXHAUSTED` | 参与班级占用是共同瓶颈 | `/classes/{classId}` 查看班级课表 |
| 6 | `VENUE_EXHAUSTED` | 指定场地占用是共同瓶颈 | `/venues` 或走班目标场地 |
| 7 | `NO_FEASIBLE_SLOT` | 无上述可归因瓶颈或域为空 | `/subjects` 检查科目规则 |

`suggested_actions` 至少一条，`configRef` 只读定位，不自动修改配置。

### 6.2 统计口径

- `conflict_count = COUNT(conflict_detail WHERE resolution='UNRESOLVED')`。
- `IGNORED_ONCE` 不进入冲突数，但 `has_manual_exemption=true` 且导出/统计可识别。
- 未排清单行数单独进入 `unscheduled_count`；不得合并或掩盖。
- 三类核心冲突的原始行数用于验收断言；生成结果应为 0（人工忽略只能在显式操作后产生 `IGNORED_ONCE` 行）。

### 6.3 只本次忽略

请求：`POST /timetable-plans/{planId}/conflicts/{conflictId}/ignore-once`，body `{reason, version}`。

事务：校验方案版本、学期未存档、冲突属于当前 `generation_no`、`ignorable=true` 且尚未处理；写 `conflict_detail.resolution='IGNORED_ONCE'`、`timetable_plan.has_manual_exemption=true`、`version+1`、`conflict_ignore`（含对象快照）、操作日志和 `bc.timetable.conflict.ignored-once` outbox。

- 「只本次」= 只对当前 `generation_no` 有效；下一次生成 `generation_no+1` 并删除旧冲突明细，重新校验后再次提示。
- 任何 `registry` / `resource` 配置表零写入；`conflict_ignore` 与操作日志是允许的审计写入。
- 容量、锁定、已存档不提供入口；手工勾选伪造请求返回 `409 STATE_CONFLICT`。

### 6.4 去修改配置

`POST .../resolve-config` 只写 `resolution='CONFIG_CHANGED'`、操作日志和当前方案版本；返回 `{route, configRef}`。不改配置本身；用户到目标页面保存后，下一次生成重新读取快照。

## 7. 方案生命周期与 API

### 7.1 状态机

```text
(create/generate/save-as) -> DRAFT
DRAFT --publish--> PUBLISHED
PUBLISHED --publish(new, confirmOverwrite=true)--> SUPERSEDED
PUBLISHED --semester archive--> ARCHIVED
DRAFT --delete--> logical deleted
```

`SUPERSEDED` / `ARCHIVED` 只读，可查看/导出，不可发布/删除/调课/锁定。

### 7.2 API 行为

| 方法/路径 | 请求 | 成功/失败 |
|-----------|------|-----------|
| `GET /timetable-plans?semesterId=` | 学期筛选 | 200 列表 |
| `POST /timetable-plans` | `semesterId,name,scheduleTemplateVersionId` | 201 空 DRAFT；模板不一致 400；存档 409 |
| `GET /timetable-plans/:id` | — | 详情与 version |
| `PATCH /timetable-plans/:id` | `name,version` | 200；非 DRAFT 409 |
| `DELETE /timetable-plans/:id?version=` | 查询版本 | 204；仅 DRAFT；非 DRAFT 409 |
| `POST .../generate` | `version,preserveLocked` | 200 DRAFT + 统计；存档/版本 409 |
| `POST .../save-as` | `name,version` | 201 独立 DRAFT；源不变 |
| `POST .../publish` | `version,confirmOverwrite` | 200；有正式且未确认 409；已存档 409 |
| `GET .../conflicts` | — | 冲突明细（含 `ignorable`） |
| `GET .../unscheduled` | — | 未排清单 |
| `POST .../ignore-once` | `reason,version` | 200；不可忽略 409 |
| `POST .../resolve-config` | `version` | `{route,configRef}` |
| `POST .../lessons/:lessonId/lock` / `unlock` | `version` | 200；状态/存档/版本 409 |

### 7.3 发布/覆盖事务

1. `SELECT` 方案与学期；校验 DRAFT、版本、学期未存档。
2. 查询同学期 `PUBLISHED`：不存在则直接发布；存在且 `confirmOverwrite=false` → `409 STATE_CONFLICT`，`details.planName` 返回现正式方案名，零写入。
3. 存在且 `confirmOverwrite=true`：同事务旧方案 `PUBLISHED -> SUPERSEDED` 并写 `superseded_at`，新方案 `DRAFT -> PUBLISHED` 并写 `published_at/by/version+1`。
4. 冲突数必须为 0；未解决的 `CAPACITY/LOCKED/RULE/CORE` 冲突一律阻断。`IGNORED_ONCE` 只作为人工豁免，方案标记 `has_manual_exemption`。
5. 同事务写 `operation_log`（`OVERWRITE` 或 `PUBLISH`）与 `bc.timetable.plan.published` outbox。

### 7.4 锁定/解锁

- 锁定：仅 `DRAFT/PUBLISHED` 且未存档；`version` 匹配；置 `locked=true, locked_at, locked_by`，`version+1`，写 `LOCK` 操作日志。
- 解锁：仅 `DRAFT/PUBLISHED` 且未存档；`version` 匹配；置 `locked=false` 并清追踪字段，`version+1`，写 `UNLOCK` 操作日志。
- 锁定课次在后续生成中作为锚点保留；若有冲突，保留原位置并产生明细/未排，不移动。
- 移动锁定课次由 D06 返回 `409 STATE_CONFLICT`「课程已锁定，请先解锁」。

### 7.5 操作日志与 outbox

为满足 D05 要求，契约新增 `operation_module` 值：`GENERATE`、`SAVE_AS`、`IGNORE_ONCE`、`LOCK`、`UNLOCK`。映射：

| 动作 | module | action |
|------|--------|--------|
| 删除草稿 | `DELETE` | 删除草稿 |
| 新建/重命名草稿 | 不写七类关键操作日志 | 不适用 |
| 生成/重新生成 | `GENERATE` | 生成方案 |
| 另存 | `SAVE_AS` | 另存方案 |
| 发布 | `PUBLISH` | 发布 |
| 覆盖发布 | `OVERWRITE` | 覆盖发布 |
| 只本次忽略 | `IGNORE_ONCE` | 只本次忽略 |
| 锁定/解锁 | `LOCK` / `UNLOCK` | 锁定课次 / 解锁课次 |

`action` 固定写中文动作，不得写英文代码；操作日志、outbox 与业务写入必须是同一事务，任一失败全部回滚。`conflict_ignore` 中保留对象快照，旧冲突明细删除后仍可审计。

## 8. 前端设计

### 8.1 `/scheduling` 一键智能排课

- 顶部：当前学期选择、模板版本（只读）、生成按钮。生成时显示「正在为 N 个班级安排课程，预计 5 秒内完成」。
- 方案列表：名称、生成时间、冲突数、未排数、状态、操作（打开/预览/另存/发布/删除草稿）。
- 不存在正式课表时发布按钮可用；存在时点击先加载现正式方案名并弹出二次确认；取消零变化。
- 生成完成展示同一来源的 `conflictCount`、`unscheduledCount`、`durationMs`，不前端重算。
- 冲突数 > 0 仍允许保存 DRAFT；显示「查看未排清单」和「进入冲突中心」。

### 8.2 `/scheduling/pre` 预排与锁定

- 课表网格按班级/教师/场地查看；空槽可预排科目、教师、场地、单双周。
- 锁定开关显示锁图标；锁定课次只读，可解锁；生成时发送 `preserveLocked=true`。
- 预排保存前校验硬约束；失败显示槽位红色高亮、对象、节次、原因与建议，不落库。

### 8.3 `/conflicts` 冲突中心

- 左侧方案/运行筛选，主区冲突卡片：类型、涉及对象、节次、规则、建议。
- 两个处置按钮：可归因且可忽略时显示「只本次忽略」并弹二次确认/原因；所有卡片都显示「去修改配置」并跳转 `route`。
- `CAPACITY_EXCEEDED`、`LOCKED_VIOLATION`、存档态不渲染忽略按钮；手工请求由后端 409 兜底。
- 空态：「当前方案没有待处理冲突」；有未排时并列展示未排原因与跳转建议。
- `hasManualExemption=true` 时显示醒目标识「含本次人工豁免」，但冲突数仍按同一口径展示。

## 9. D15 测试装置

### 9.1 输入锚点

- 模板 = `周一至周三`，4 节；班级 A=`...0105`、B=`...0106`；教师张=`...0109`、李=`...010a`；科目数学=`...0107`、英语=`...0108`；功能室 301=`...010b`。
- A 数学 2 节（张，`REQUIRED` 连堂）、A 英语 1 节（李，301）、B 数学 2 节（李）、B 英语 1 节（张，301）。
- 英语禁排周三第 3-4 节；李周二第 1 节免排；张周三第 4 节免排。
- 数学 `venueId=null`，表示班级归属普通教室；英语必须占 301。

### 9.2 30 格口径

PRD 附件 A 的班级日部分是 **6 列 × 5 行 = 30 个表格格**：6 个班级日列表头格（周一 A/B、周二 A/B、周三 A/B）+ 24 个 `(classId,weekday,period)` 数据坐标；行首「时段」标签是行头，不在 30 格计数内。数据坐标逐格断言 `subjectId/teacherId/venueId/null`，6 个班级日列表头逐字断言。不得把“30 格”理解成新增 6 个匿名坐标，也不得修改附件 A。

| 时段 | 周一 A 班 | 周一 B 班 | 周二 A 班 | 周二 B 班 | 周三 A 班 | 周三 B 班 |
|------|----------|----------|----------|----------|----------|----------|
| 第 1 节 | 数学·张（连堂①） | 数学·李 | —（李免排） | — | — | 数学·李 |
| 第 2 节 | 数学·张（连堂②） | — | — | — | — | — |
| 第 3 节 | 英语·李（301） | — | — | 英语·张（301） | —（禁排） | —（禁排） |
| 第 4 节 | — | — | — | — | —（禁排/张免排） | —（禁排） |

### 9.3 逐格断言结构

```ts
// 机器可读副本：docs/knowledge/designs/D15-annex-a.fixture.json
// 实际测试在实现轮次创建；本轮只定义结构，不执行。
const expectedRows = [
  { label: '第 1 节', cells: [cell('0105','math', '0109', null), cell('0106','math','010a',null), null, null, null, cell('0106','math','010a',null)] },
  { label: '第 2 节', cells: [cell('0105','math','0109',null), null, null, null, null, null] },
  { label: '第 3 节', cells: [cell('0105','english','010a','010b'), null, null, cell('0106','english','0109','010b'), null, null] },
  { label: '第 4 节', cells: [null, null, null, null, null, null] },
];
// cell = { subjectId, teacherId, venueId }；null 表示空格。
// 比对要按 classId/weekday/period 排序，而不能依赖 lessonId 或数据库返回顺序。
```

### 9.4 断言与输出

1. 24 个数据坐标逐格 deep-equal；空格必须无 lesson，不得用占位行。
2. 6 个表头格逐字 deep-equal；总断言覆盖 30 个表格格。
3. 计算三类核心冲突：教师、班级、场地各自按 `(weekday,period,parity)` 分组，结果均为 0。
4. 连续生成 3 次；比较每格 `(subjectId,teacherId,venueId,null)`、未排原因、冲突指纹集合，必须完全一致。
5. 输出 `durationMs`、未排数、冲突数；本轮设计态未执行，实际值在实现轮次回填，禁止预填假耗时。
6. 50 班固定数据集：50 班/120 教师/15 科目/60 场地/1500 课次、4C8G、预热 1 次、5 次取 p95；目标 `<=5000ms`，记录未排课时与原因。

## 10. 验证矩阵

| 编号 | 断言 | 设计证据 |
|------|------|----------|
| D05-01 | D15 30 表格格（24 坐标）一致 | §9；实现后 `d15` 装置 |
| D05-02 | 三类核心冲突 0 | §4、§9.4 |
| D05-03 | 3 次生成一致 | §3.4、§5.4、§9.4 |
| D05-04 | 50 班 p95 <=5s | §9.4；性能数据集约定 |
| D05-05 | 覆盖未确认 409、旧方案不变 | §7.3 |
| D05-06 | 覆盖确认旧 SUPERSEDED、新 PUBLISHED、唯一索引 | §2.2、§7.3 |
| D05-07 | 锁定位置不变；拖拽锁定 409 | §4.1 H7、§7.4 |
| D05-08 | 容量冲突明细且无忽略 | §4.3、§6.3 |
| D05-09 | 只本次忽略不改配置、下次再现 | §6.3、§7.5 |
| D05-10 | 存档学期写操作 409 | §4.1 H12、§7.2 |
| D05-11 | 冲突方案保存 DRAFT 并可重开 | §2.4、§7.2 |
| D05-12 | 未排清单对象/原因/建议/跳转 | §2.4、§6.1 |

## 11. 契约修正与待实现项

1. `subject_period_rule` 增加 `fixed_slots`，使 H10 可执行；既有 `fixed_slot_rule_enabled=true` 但无槽位集合的缺口必须关闭。
2. 所有写端点补 `version`：生成、锁定/解锁、预排、删除草稿/课次；覆盖发布继续使用 `confirmOverwrite`。
3. `operation_module` 新增 D05 审计动作，避免生成/忽略被塞入 `ADJUST`。
4. `conflict_ignore` 不设 `conflict_id` 外键，避免重新生成删除冲突时触发 append-only 更新并丢失审计关联。
5. D02 必须导出 `ClassQueryService.listSchedulingClasses` 与 `SubjectQueryService.listSchedulingSubjects`；D03 必须导出已设计的 Teacher/Assignment QueryService。
6. 单双周：引擎和预排接口支持 `week_parity`；自动任课的奇偶拆分需要 D02/D03 后续暴露 assignment parity 配置，未提供时默认 `ALL`。
7. 本轮不实现 `TimetableEngineService`、API、页面或 D15 执行业务；静态设计测试只验证产物和契约一致。

## 12. 验收结论口径

设计态可以证明表/状态/约束/API/D15 断言可表达且彼此一致；不能声称引擎已通过 D15、性能或回归测试。实现轮次必须以本文件 §9-§10 为验收入口，先 D15 后 50 班性能，再执行生命周期、锁定、冲突、忽略和存档 409 回归。
