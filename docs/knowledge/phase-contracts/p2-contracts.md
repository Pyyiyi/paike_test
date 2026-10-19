# Phase 2 契约摘要（p2-contracts.md）

> Phase 2 = 排课与课表域：timetable（D05、D06）与 statistics（D11）。
> 依赖 Phase 1 的主数据只读查询服务；不反向依赖 registry/resource 的写模型。
> 所有端点前缀 `/api/v1`，响应统一 `{ data, meta? }`，写请求携带 `version` 与 `X-CSRF-Token`。

---

## 1. 产出卡片

| 卡片 | 范围 |
|------|------|
| D05 | 排课引擎、方案生命周期（草稿/另存/发布/覆盖/存档）、D15、锁定、冲突明细、未排课时、D21 忽略 |
| D06 | 五视图、拖拽调课、撤销/重做、空闲时段查询、单双周展示 |
| D11 | 教师工作量统计（常规/连堂/合班/加班占位）、周/学期口径 |

---

## 2. 表结构

```sql
CREATE TYPE plan_status AS ENUM ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED');
CREATE TYPE week_parity AS ENUM ('ALL','ODD','EVEN');
CREATE TYPE scheduling_unit_type AS ENUM ('ASSIGNMENT','COMBINED_CLASS','WALKING_GROUP');
CREATE TYPE unscheduled_reason AS ENUM ('NO_FEASIBLE_SLOT','TEACHER_EXHAUSTED','CLASS_EXHAUSTED','VENUE_EXHAUSTED','CAPACITY','LOCK_CONFLICT','TIME_LIMIT');
CREATE TYPE conflict_type AS ENUM ('TEACHER_OVERLAP','CLASS_OVERLAP','VENUE_OVERLAP','CAPACITY_EXCEEDED','LOCKED_VIOLATION','RULE_VIOLATION');
CREATE TYPE conflict_resolution AS ENUM ('UNRESOLVED','IGNORED_ONCE','CONFIG_CHANGED','RESOLVED');
CREATE TYPE adjustment_action AS ENUM ('APPLY','UNDO','REDO');

timetable_plan (
  plan_id uuid pk,
  semester_id uuid not null,
  source_plan_id uuid null,
  name text not null,
  status plan_status not null default 'DRAFT',
  version int not null default 0,
  generation_no int not null default 0,
  schedule_template_version_id uuid not null,
  generation_seed bigint null,
  snapshot_hash text null,
  conflict_count int not null default 0,
  unscheduled_count int not null default 0,
  duration_ms int null,
  has_manual_exemption boolean not null default false,
  generated_at timestamptz null,
  generated_by uuid null,
  published_at timestamptz null,
  published_by uuid null,
  superseded_at timestamptz null,
  archived_at timestamptz null,
  created_at, updated_at, deleted_at
);
CREATE UNIQUE INDEX uq_plan_one_published
  ON timetable_plan (semester_id) WHERE status='PUBLISHED' AND deleted_at IS NULL;

lesson (
  lesson_id uuid pk,
  plan_id uuid not null,
  weekday smallint not null,
  period smallint not null,
  week_parity week_parity not null default 'ALL',
  subject_id uuid not null,
  teacher_id uuid not null,
  venue_id uuid null,
  unit_type scheduling_unit_type not null,
  unit_id uuid not null,
  locked boolean not null default false,
  locked_at timestamptz null,
  locked_by uuid null,
  created_at, updated_at
);
-- 同一单元同一槽位/周次只允许一行
UNIQUE (plan_id, unit_type, unit_id, weekday, period, week_parity);

lesson_class (lesson_id uuid, class_id uuid, primary key (lesson_id, class_id));

unscheduled_lesson (
  unscheduled_id uuid pk,
  plan_id uuid not null,
  unit_type scheduling_unit_type not null,
  unit_id uuid not null,
  class_ids uuid[] not null,
  subject_id uuid not null,
  teacher_id uuid not null,
  required_periods int not null,
  unplaced_periods int not null,
  reason_code unscheduled_reason not null,
  reason_detail text not null,
  suggested_actions jsonb not null,      -- 至少一项 {label,route,configRef}
  source_config_refs jsonb not null default '[]',
  created_at
);

conflict_detail (
  conflict_id uuid pk,
  plan_id uuid not null,
  generation_no int not null,
  fingerprint char(64) not null,
  lesson_id uuid null,
  conflict_type conflict_type not null,
  teacher_id uuid null,
  class_ids uuid[] null,
  venue_id uuid null,
  weekday smallint null,
  period smallint null,
  week_parity week_parity not null default 'ALL',
  rule_id text null,
  config_ref jsonb null,
  suggestion text not null,
  ignorable boolean not null default false,
  ignore_blocked_reason text null,
  resolution conflict_resolution not null default 'UNRESOLVED',
  created_at
);
UNIQUE (plan_id, generation_no, fingerprint);

conflict_ignore (
  ignore_id uuid pk,
  plan_id uuid not null,
  generation_no int not null,
  conflict_id uuid null,                 -- 故意不设 FK：保留删除旧冲突后的审计
  conflict_fingerprint char(64) not null,
  conflict_type conflict_type not null,
  object_snapshot jsonb not null,
  rule_id text null,
  config_ref jsonb null,
  operator_id uuid not null,
  reason text not null,
  scope text not null default 'THIS_RUN' check (scope='THIS_RUN'),
  created_at
);

adjustment_history (
  history_id uuid pk,
  plan_id uuid not null,
  session_id text not null,
  operator_id uuid not null,
  unit_id uuid not null,
  operations jsonb not null,
  action adjustment_action not null,
  version_before int not null,
  version_after int not null,
  created_at
);
```

索引：`lesson(plan_id,weekday,period)`、`lesson(plan_id,teacher_id,weekday,period)`、`lesson(plan_id,venue_id,weekday,period)`、`lesson(plan_id,locked) WHERE locked`、`lesson_class(class_id,lesson_id)`、`unscheduled_lesson(plan_id)`、`conflict_detail(plan_id,resolution)`、`conflict_detail(plan_id,weekday,period)`、`conflict_ignore(plan_id,created_at DESC)`、`adjustment_history(plan_id,operator_id,session_id,created_at DESC)`。

> 完整可执行草案见 `docs/knowledge/designs/0020_timetable_plan.sql` 与 `0021_timetable_lesson_conflict.sql`。

---

## 3. 排课引擎契约（D05）

### 3.1 输入快照

生成时从 registry/resource 的查询服务读取一次并固定：

| 输入 | 来源 |
|------|------|
| 学期、钉扎模板版本（节次、开放星期） | SemesterQueryService / TemplateQueryService |
| 校历（停课、调休） | CalendarQueryService |
| 班级（人数、年级） | ClassQueryService |
| 科目与课时规则 | SubjectQueryService |
| 教师、任课（周课时、连堂偏好、免排/禁排） | TeacherQueryService / AssignmentQueryService |
| 场地（类型、容量、状态） | VenueQueryService |
| 合班、走班 | SchedulingUnitQueryService |
| 当前方案中已锁定课次 | timetable 自身 |

快照不落库；生成结果与 `schedule_template_version_id` 落库，保证可追溯。

### 3.2 约束

**硬约束（违反即不可放置）**

| 编号 | 约束 |
|------|------|
| H1 | 同一教师同一 `(weekday, period)` 不重叠；`ALL` 与任意周次冲突，`ODD` 与 `EVEN` 互不冲突 |
| H2 | 同一班级同一 `(weekday, period)` 不重叠（含合班/走班全部参与班级） |
| H3 | 同一场地同一 `(weekday, period)` 不重叠；未指定场地不占共享场地 |
| H4 | 班级人数 ≤ 场地容量（D19） |
| H5 | 教师免排/禁排时段不可放置（免排=主动配置，禁排=业务规则） |
| H6 | 科目禁排时段不可放置 |
| H7 | 锁定课次不得移动、不得被覆盖 |
| H8 | 合班/走班作为一个排课单元：教师 + 场地 + 全部参与班级同一时段 |
| H9 | 每个任课单元的周课时必须排满；未排满计入 `unscheduled_lesson` |
| H10 | 启用固定时段规则时，指定课程只能落在指定时段 |
| H11 | 只能落在模板开放的星期与存在的节次内 |
| H12 | 已存档学期禁止生成/调课/发布 |

**软约束（按优先级评分，不阻断）**

| 编号 | 约束 | 默认 |
|------|------|------|
| S1 | 连堂偏好：`REQUIRED` 视为硬约束，`PREFERRED` 加分 | 任课配置 |
| S2 | 时段优先（上午/下午） | 关闭 |
| S3 | 课时均衡（同一科目不连续堆叠） | 关闭 |
| S4 | 上下午均衡 | 关闭 |
| S5 | 同日同科目分散（非连堂时优先不同教学日） | 开启（引擎内部） |
| S6 | 节次靠前优先 | 开启（引擎内部） |

> S3/S4 对应 D17 的可配开关，默认关闭；S5/S6 是引擎确定性排序的一部分，不是业务规则，可在不改动结果正确性的前提下调整。

### 3.3 算法与确定性

1. **固定种子**：`seed = BigInt(sha256("paike-scheduler-v1\0"+semesterId+"\0"+templateVersionId+"\0"+engineVersion).slice(0,15))`；应用服务内部允许测试传入固定 seed，公共 API 不接受客户端随机种子。种子写入 `timetable_plan.generation_seed`，只用于复现，不驱动随机重启。禁止 `Math.random`、随机排序、当前时间排序和数据库物理顺序。
2. **固定快照**：所有跨域输入在只读 `REPEATABLE READ` 事务中读取一次并深冻结；数组按 UUID/业务键稳定排序；快照不落库，只保存模板版本、seed 与 `snapshotHash`。
3. **变量与静态优先级**：锁定课次先转为固定锚点，不参与搜索；剩余变量按 `合班/走班 > REQUIRED 连堂 > 禁排/免排数量降序 > weeklyPeriods 降序 > unitType > unitId > occurrenceNo` 形成稳定基线。
4. **MRV**：每步重新计算各未放变量的可行域；先选域最小者，域相同用静态优先级与 `variableKey` 决胜；候选槽位先硬过滤，再按 §4.2 的字典序软分排序。
5. **候选顺序**：`REQUIRED` 连续块优先于单节；然后依次比较连堂惩罚、同科目跨班对齐、同日分散、S2/S3/S4、同 weekday 内较早 period、weekday/period/对象 id。`ALL` 与任意奇偶相交，`ODD` 与 `EVEN` 不相交。
6. **有界回溯**：单变量/单元回退最多 200 次；总回溯步数上限 200000；总软预算 4500ms（为 IO 留 500ms）。超限后保留当前最优点，未完成需求进入未排清单，不抛“随机重启”，不把未排伪装成冲突。
7. **部分结果**：先做一次确定性贪心构造 incumbent；回溯只允许改善 incumbent。超时原因 `TIME_LIMIT`，域为空原因按 §3.6 的最窄瓶颈归类。
8. **结果不变量**：已放置课次必须满足 H1-H12；不得为凑课时制造冲突；同一输入/模板/锁定集合/代码版本连续 3 次输出逐格一致。
9. **D15 公共基准**：附件 A 是唯一期望表；算法只能通过通用稳定排序和软约束复现，不得写 D15 常量、对象 id 特例或期望表分支。

### 3.4 D15 输入映射与格数口径

| 项 | 值 |
|----|------|
| 模板 | 周一至周三，4 节 |
| 班级 | `...0105` A 班、`...0106` B 班 |
| 教师 | `...0109` 张（T1001）、`...010a` 李（T1002） |
| 科目 | `...0107` 数学、`...0108` 英语 |
| 场地 | `...010b` 301 功能室（仅英语使用）；普通教室归班，`venueId=null` |
| 任课 | A 数学×2 张（`REQUIRED` 连堂）、A 英语×1 李（301）、B 数学×2 李、B 英语×1 张（301） |
| 禁排 | 英语禁排周三第 3-4 节 |
| 免排 | 李 周二第 1 节；张 周三第 4 节 |

期望结果见 PRD 附件 A。附件 A 的班级日部分是 **6 列 × 5 行 = 30 个表格格**：6 个班级日列表头格（周一 A/B 班、周二 A/B 班、周三 A/B 班）+ 24 个 `classId × weekday × period` 数据坐标；行首「时段」标签不在 30 格计数内。逐格比对字段为 `(subjectId,teacherId,venueId)`；空格必须无 lesson。不得把“30 格”解释为新增坐标，也不得修改附件 A。

实现测试必须按 `(classId,weekday,period)` 排序后比较，排除随机 `lessonId`；连续生成 3 次比较同一签名。D15 输入锚点来自 `seed-anchors.sql`，测试不得依赖自增 id 或当前时间。

### 3.5 方案生命周期

```
DRAFT ──发布（二次确认；覆盖时旧 PUBLISHED→SUPERSEDED）──▶ PUBLISHED
PUBLISHED ──学期存档──▶ ARCHIVED
DRAFT ──逻辑删除（仅未被引用且非 ARCHIVED）──▶ deleted
```

规则：

- 同一学期至多一个 `PUBLISHED`（数据库部分唯一索引 + 事务内检查）。
- 发布前必须通过冲突校验；存在 `UNRESOLVED` 冲突时拒绝发布。`IGNORED_ONCE` 只作为当前运行的人工豁免，不得把容量/锁定/存档冲突伪装成已解决。
- 覆盖发布请求携带 `version` 与 `confirmOverwrite`；已有 `PUBLISHED` 且未确认 → `409 STATE_CONFLICT`，`details` 返回现正式方案名，零写入。
- 覆盖发布：同一事务内旧方案 `PUBLISHED→SUPERSEDED`、新方案 `DRAFT→PUBLISHED`；任一步失败全部回滚。
- `SUPERSEDED`/`ARCHIVED` 只读，可查看/导出，不可发布、不可删除、不可调课/锁定。
- `SaveAsPlan` 复制课次、锁定状态、周次类型与冲突/未排摘要，生成独立 `DRAFT`；源方案不变，新方案 `source_plan_id` 指向源。
- 生成新的 `DRAFT` 不自动删除旧草稿；仅 DRAFT 可逻辑删除。
- 所有写动作更新 `version`；版本不匹配 `409 VERSION_CONFLICT`，不写业务日志/outbox。
- 生成、发布/覆盖、忽略、锁定/解锁、另存同事务写业务数据、操作日志和对应 outbox；任何一步失败全部回滚。

### 3.6 冲突与未排课时

- 每次生成/重新生成：清空该方案已有 `conflict_detail` 与 `unscheduled_lesson`，递增 `generation_no` 后写入本次统计；旧 `conflict_ignore` 审计保留。
- `conflict_count = resolution='UNRESOLVED'` 的冲突数；`has_manual_exemption` 单列，`IGNORED_ONCE` 不伪装为 0 冲突。
- 核心冲突 `TEACHER_OVERLAP / CLASS_OVERLAP / VENUE_OVERLAP` 对最终课次按 `(weekday,period,parity)` 逐维分组；合法自动生成结果必须为 0。
- 容量、锁定、规则冲突按 `conflict_type` 持久化；`ignorable` 只在 `ruleId + configRef` 可归因且类型不是 `CAPACITY_EXCEEDED/LOCKED_VIOLATION` 时为 true。
- 被拒绝的调课请求返回临时冲突对象，不落库；只有可保存的草稿生成/重新生成写入持久化清单。
- 未排 `reasonCode` 及优先级：`TIME_LIMIT > CAPACITY > LOCK_CONFLICT > TEACHER_EXHAUSTED > CLASS_EXHAUSTED > VENUE_EXHAUSTED > NO_FEASIBLE_SLOT`。
- `suggestedActions` 至少包含一个可跳转入口，结构 `{label,route,configRef}`；跳转只定位配置，不自动修改。

### 3.7 人工豁免（D21）

- 只对可归因到 `ruleId/configRef` 的冲突开放「只本次忽略」；容量超限、锁定课程移动、已存档写操作不提供入口。
- 忽略请求携带 `reason` + `version`；同一事务置 `conflict_detail.resolution='IGNORED_ONCE'`、方案 `has_manual_exemption=true`、`version+1`、追加 `conflict_ignore`（含冲突指纹、类型、对象快照、规则/配置引用）、操作日志与 `bc.timetable.conflict.ignored-once` outbox。
- `conflict_ignore.scope` 恒为 `THIS_RUN`；重新生成删除旧冲突明细但保留忽略审计，下一次 `generation_no` 重新校验并再次提示。
- 配置表零写入；若请求伪造不可忽略类型，返回 `409 STATE_CONFLICT`。

### 3.8 锁定（F9）

- 锁定粒度：课次；`locked=true` 的 `locked_at/locked_by` 必须同时存在。
- 锁定课次在自动排课、方案微调、拖拽调课中均不可移动；尝试移动返回 `409 STATE_CONFLICT`，提示「课程已锁定，请先解锁」。
- 解锁后可被自动生成或调课移动；解锁写 `UNLOCK` 操作日志。
- 预排流程：创建空 `DRAFT` → 手工放置/锁定课次 → `generate?preserveLocked=true`。
- `preserveLocked=false` 且存在锁定课次时返回 409；不得因重新生成而丢失锁定。

### 3.9 快照查询服务契约

`TimetableSnapshotReader` 不直接读 `semester/class/subject/teacher/...` 表，只调用：

- D01：`SemesterQueryService`、`TemplateQueryService`、`CalendarQueryService`。
- D02：`ClassQueryService.listSchedulingClasses()`、`SubjectQueryService.listSchedulingSubjects()`；`SubjectRuleSnapshot` 必须含 `fixedSlots`（H10）。
- D03：`TeacherQueryService`、`AssignmentQueryService.listSchedulingAssignments()`；任课 `weeklyPeriods` 是课时权威来源，禁排/免排分字段返回。
- D04：`VenueQueryService`、`SchedulingUnitQueryService.list()`；合班/走班不拆班。

读取规则：只读 `REPEATABLE READ`、一次读取、深冻结、稳定排序、不落库、不回写。`venueId=null` 是班级归属普通教室，不占共享场地；指定功能室必须执行 H4 容量校验。

### 3.10 事务与审计

| 动作 | 业务写入 | 审计/outbox |
|------|----------|-------------|
| 生成/重新生成 | plan 统计、lessons、conflicts、unscheduled、version/generation | `GENERATE` 操作日志 + `bc.timetable.plan.generated` |
| 发布/覆盖 | 新 plan `PUBLISHED`、旧 plan `SUPERSEDED`、version | `PUBLISH/OVERWRITE` + `bc.timetable.plan.published` |
| 只本次忽略 | conflict resolution、plan version/manual flag | `IGNORE_ONCE` + `bc.timetable.conflict.ignored-once` |
| 锁定/解锁 | lesson lock fields、plan version | `LOCK/UNLOCK` 操作日志 |
| 另存 | 新 DRAFT 及子记录、sourcePlanId | `SAVE_AS` 操作日志 |

全部动作均在业务事务内写操作日志与 outbox；版本冲突、存档 409、不可忽略 409 均零业务写入。

## 4. API（D05 / D06 / D11）

### 4.1 方案与生成

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/timetable-plans?semesterId=` | 方案列表（名称/时间/冲突数/未排数/状态） |
| POST | `/timetable-plans` | 新建空草稿 |
| GET | `/timetable-plans/:planId` | 方案详情（含版本、统计） |
| PATCH | `/timetable-plans/:planId` | 重命名（`version`） |
| DELETE | `/timetable-plans/:planId` | 删除草稿（`version`；非草稿拒绝） |
| POST | `/timetable-plans/:planId/generate` | 生成/重新生成（`preserveLocked`） |
| POST | `/timetable-plans/:planId/save-as` | 另存为新草稿 |
| POST | `/timetable-plans/:planId/publish` | 发布（`version`；覆盖确认在前端） |
| GET | `/timetable-plans/:planId/conflicts` | 冲突明细 |
| GET | `/timetable-plans/:planId/unscheduled` | 未排课时清单 |
| POST | `/timetable-plans/:planId/conflicts/:conflictId/ignore-once` | 只本次忽略（`reason`） |
| POST | `/timetable-plans/:planId/conflicts/:conflictId/resolve-config` | 记录「去修改配置」并返回跳转路由 |

生成响应：

```json
{
  "data": {
    "planId": "uuid",
    "status": "DRAFT",
    "conflictCount": 0,
    "unscheduledCount": 0,
    "durationMs": 1830,
    "hasManualExemption": false
  }
}
```

发布请求：

```json
{ "version": 7, "confirmOverwrite": true }
```

已存在 `PUBLISHED` 且 `confirmOverwrite=false` → `409 STATE_CONFLICT`，`details` 返回现有正式方案名。所有生成/发布/覆盖/忽略/锁定/另存/调课写请求必须携带当前 `version`；已存档学期一律 409。锁定/解锁请求体为 `{version}`；删除草稿和删除预排课次使用 `?version=`。

### 4.2 调课与锁定

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/timetable-plans/:planId/moves/validate` | 只校验不写入，返回冲突 |
| POST | `/timetable-plans/:planId/adjustments` | 批量保存调课（一个撤销单元） |
| POST | `/timetable-plans/:planId/adjustments/undo` | 撤销一个单元（客户端提交操作，服务端重校验） |
| POST | `/timetable-plans/:planId/adjustments/redo` | 重做一个单元 |
| POST | `/timetable-plans/:planId/lessons/:lessonId/lock` | 锁定 |
| POST | `/timetable-plans/:planId/lessons/:lessonId/unlock` | 解锁 |
| POST | `/timetable-plans/:planId/lessons` | 预排课次（仅草稿） |
| DELETE | `/timetable-plans/:planId/lessons/:lessonId` | 删除预排课次（仅草稿且未锁定） |

批量调课请求：

```json
{
  "version": 12,
  "unitId": "uuid",
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

规则：

- 整批要么全部成功，要么全部不写；任一操作冲突 → `409` + 冲突明细。
- 保存成功后 `version+1`、写 `adjustment_history`、`operation_log`、`bc.timetable.lesson.moved` 事件。
- 撤销/重做同样整组校验；锁定、容量、存档状态任一不满足 → 整组拒绝。
- 撤销栈上限 50 个单元，按「方案 + 用户 + 编辑会话」维护；刷新/离开方案后清空（A-15）。

### 4.3 五视图与空闲

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/timetables?semesterId=&dimension=&objectId=&planId=&unitType=&parity=` | 五视图统一入口 |
| GET | `/my/timetable?semesterId=&parity=` | 教师本人课表 |
| GET | `/my/classes?semesterId=` | 教师关联班级（任课 ∪ 班主任） |
| GET | `/my/classes/:classId/timetable?semesterId=&parity=` | 关联班级课表 |
| GET | `/idle-slots?semesterId=&dimension=TEACHER\|CLASS&objectId=&planId=&parity=` | 空闲时段 |
| GET | `/my/idle-slots?semesterId=&parity=` | 教师本人空闲 |

`dimension ∈ CLASS / TEACHER / SCHOOL / VENUE / ASSIGNMENT`。

课表响应：

```json
{
  "data": {
    "semesterId": "uuid",
    "dimension": "CLASS",
    "objectId": "uuid",
    "parity": "ALL",
    "weekdays": [1, 2, 3, 4, 5],
    "periods": [{ "periodNo": 1, "startTime": "08:00", "endTime": "08:45" }],
    "cells": [
      {
        "weekday": 1,
        "period": 1,
        "lessonId": "uuid",
        "subjectName": "数学",
        "teacherName": "张老师",
        "classNames": ["七年级（1）班"],
        "venueName": "301",
        "weekParity": "ALL",
        "locked": true
      }
    ]
  }
}
```

规则：

- 五视图共享同一查询服务与同一数据源（A-21）。
- 教师请求非本人对象 → `403 FORBIDDEN`；前端隐藏不作为安全边界。
- `parity=ODD` 展示 `ALL+ODD`，`EVEN` 展示 `ALL+EVEN`；`ALL` 展示全部并按周次标签区分。
- `planId` 可选：传值时必须是该学期 DRAFT/PUBLISHED 方案；省略时优先 `PUBLISHED`，否则最新 `DRAFT`。
- `unitType` 仅 `dimension=ASSIGNMENT` 必填；常规任课/合班/走班分别传 `ASSIGNMENT`/`COMBINED_CLASS`/`WALKING_GROUP`。
- `/timetables` 与 `/idle-slots` 允许 `TEACHER` 调用但服务端做数据范围过滤：教师仅本人教师视图、关联班级视图和本人空闲；其他对象/维度 `403 FORBIDDEN`。
- `adjustments` 请求必须携带 `confirm=true`；未确认或 `false` 返回 `400 VALIDATION_ERROR`，零写入。
- 空闲槽位 = 模板开放槽位 − 该对象已占用槽位；按单双周展开后严格互补（TC-AT-011）。

### 4.4 统计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/statistics/workload?semesterId=&scope=SEMESTER\|WEEK&weekIndex=` | 工作量统计 |

响应行：

```json
{
  "teacherId": "uuid",
  "teacherName": "张老师",
  "regular": 12,
  "consecutive": 4,
  "combined": 2,
  "overtime": 0,
  "total": 18
}
```

口径（A-16）：

- 每条课次只入一类，优先级：合班 > 连堂 > 常规。
- 合班按 1 节计；连堂按实际节次计；加班恒为 0，页面显示「细则 V1.1」。
- 周口径按指定教学周的 `ALL + 对应奇偶` 课次计算；学期口径按全部教学周累计。
- 统计必须来自当前正式课表（`PUBLISHED`）；无正式课表时返回空并提示「请先发布课表」。

---

## 5. 领域事件

| 事件 | 生产者 | 消费者 | payload 要点 |
|------|--------|--------|--------------|
| `bc.timetable.plan.generated` | D05 | governance | planId, semesterId, conflictCount, unscheduledCount, durationMs |
| `bc.timetable.plan.published` | D05 | governance, registry | planId, semesterId, supersededPlanId |
| `bc.timetable.plan.archived` | D07 | governance, registry | planId, semesterId |
| `bc.timetable.lesson.moved` | D06 | governance | planId, lessonId, from, to, transactionId |
| `bc.timetable.conflict.ignored-once` | D05 | governance | planId, conflictId, operatorId, reason |

> 发布覆盖产生 `supersededPlanId`；被覆盖方案只读，不删除。

---

## 6. 前端路由

| 路由 | 页面 | 卡片 | 角色 |
|------|------|------|------|
| `/scheduling` | 一键智能排课（含方案列表） | D05 | Admin |
| `/scheduling/pre` | 预排与锁定 | D05 | Admin |
| `/conflicts` | 冲突校验中心 | D05 | Admin |
| `/timetables` | 多维度课表视图 | D06 | Admin |
| `/timetables/adjust` | 拖拽调课 / 方案微调 | D06 | Admin |
| `/me/timetable` | 我的课表 | D06 | Teacher |
| `/idle-slots` | 空闲时段查询 | D06 | Admin |
| `/me/idle-slots` | 我的空闲时段 | D06 | Teacher |
| `/statistics` | 工作量统计 | D11 | Admin |

---

## 7. 完成判定

- D15 输入逐格输出与 PRD 附件 A 完全一致（6×5 表格 30 格中的 24 个课表坐标逐字段），三类核心冲突为 0。
- 同一输入连续生成 3 次，结果逐格一致；50 班固定数据集 p95 <=5000ms。
- 覆盖发布后同一学期仅一个 `PUBLISHED`，旧方案为 `SUPERSEDED` 且只读；未确认覆盖零写入。
- 锁定课次生成后位置不变；移动锁定课次返回 409。
- 存档学期生成/发布/调课/锁定返回 409；只本次忽略不改配置且下次生成再现。
- 任一冲突调课整批不写入；撤销/重做整组回退/重放。
- 教师越权访问五视图与统计返回 403；前端无管理入口。
- 统计四类互斥、合计正确，周/学期口径可复算。
- 所有错误提示中文、可操作；关键操作二次确认并留痕。
