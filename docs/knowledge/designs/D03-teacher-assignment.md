# D03 教师、任课与账号联动设计

> 状态：设计态。本文定义实体、API、事件、查询服务与前端交互，不包含业务实现。
> 权威输入：PRD F5、`p1-contracts.md` §3.5、A-02、A-14、`contracts/` 1.0.0。

## 1. 范围与不变量

### 1.1 范围

- 教师主数据 CRUD、退校/恢复、逻辑删除与引用保护。
- 教师任课约束 CRUD 及 D05 排课快照。
- 新增教师时可选调用 D08 账号开通应用服务。
- P07「教师与任课约束」页面交互设计。

### 1.2 非范围

- 不实现排课引擎、冲突校验或手动调课；由 D05/D06 承接。
- 不实现账号密码、会话、权限或 `sys_user` 写入；由 D08/P0-02 承接。
- 不实现任课批量导入；由 D09 承接，但 D03 的字段校验是导入行校验的唯一来源。

### 1.3 强制不变量

1. `teacher.employee_no` 匹配 `^T[0-9]+$` 且在教师全表唯一；创建后不可编辑。
2. `teacher.status` 仅 `ACTIVE | LEFT`；退校不改 `employee_no`、不改历史引用、不写 `deleted_at`。
3. `teacher.deleted_at` 只由无引用教师的逻辑删除动作写入；退校使用独立动作。
4. 有任课、班主任、账号、合班/走班或历史课次引用时，删除返回 `REFERENCE_PROTECTED` 且零写入。
5. 任课保存教师、科目、班级、可选场地、周课时、连堂偏好、禁排与免排；后两者使用不同字段。
6. 同一教师可拥有多条任课，不设置年级限制，不因跨年级拒绝。
7. resource 不直接写 `sys_user`；账号开通与停用只调用 identity 导出的应用服务。

## 2. 实体设计

### 2.1 Teacher

表：`teacher`；设计迁移草案：`docs/knowledge/designs/0014_resource_teacher_assignment.sql`。实施阶段必须按该序号落入 `migrations/0014_resource_teacher_assignment.sql`，并由前序 `0003`–`0013` 迁移补齐连续序号。

| 字段 | 数据库 | API | 规则 |
|------|--------|-----|------|
| 教师 ID | `teacher_id uuid pk` | `teacherId` | UUID；不对外复用 |
| 工号 | `employee_no text unique not null` | `employeeNo` | `^T[0-9]+$`；不可编辑；退校/逻辑删除后仍保留 |
| 姓名 | `name text not null` | `name` | 去空格后非空 |
| 性别 | `gender gender_enum` | `gender` | `MALE / FEMALE / UNSPECIFIED` |
| 手机 | `phone text null` | `phone` | 可空；日志脱敏 |
| 状态 | `status teacher_status` | `status` | `ACTIVE / LEFT`；默认 `ACTIVE` |
| 版本 | `version integer` | `version` | 乐观锁；每次成功写操作递增 |
| 删除时间 | `deleted_at timestamptz null` | 不返回列表 | 逻辑删除标记；不得用于退校 |
| 时间 | `created_at / updated_at` | 不强制返回 | 时间戳由触发器维护 |

### 2.2 TeachingAssignment

表：`teaching_assignment`。

| 字段 | 数据库 | API | 规则 |
|------|--------|-----|------|
| 任课 ID | `assignment_id uuid pk` | `assignmentId` | UUID |
| 教师 | `teacher_id uuid fk` | `teacherId` | 引用在职、未删除教师 |
| 科目 | `subject_id uuid fk` | `subjectId` | 引用未删除科目，经 registry 查询服务校验 |
| 班级 | `class_id uuid fk` | `classId` | 引用未删除班级；不校验年级 |
| 场地 | `venue_id uuid null fk` | `venueId` | 可空；有值时须存在且可用 |
| 周课时 | `weekly_periods integer` | `weeklyPeriods` | 整数 `>= 1` |
| 连堂偏好 | `consecutive_preference` | `consecutivePreference` | `NONE / PREFERRED / REQUIRED` |
| 禁排 | `forbidden_slots jsonb` | `forbiddenSlots` | `Slot[]`；业务规则限定 |
| 免排 | `exempted_slots jsonb` | `exemptedSlots` | `Slot[]`；教师主动免排 |
| 版本 | `version integer` | `version` | 乐观锁 |
| 删除时间 | `deleted_at timestamptz null` | 不返回 | 任课删除为逻辑删除 |

`Slot` 为 `{ "weekday": 1..7, "period": 1..20 }`。保存前对每个数组按 `(weekday, period)` 去重并稳定排序；禁排和免排分别校验、分别落库，禁止拼成同一数组。两者可包含相同时段，但必须保留各自来源，D05 不得折叠语义。

### 2.3 唯一性

- `UNIQUE (employee_no)`：保证工号唯一。
- `UNIQUE (teacher_id, class_id, subject_id) WHERE deleted_at IS NULL`：同一教师对同一班级同一科目至多一条有效任课；不同班级、不同科目或不同教师均允许多条。
- 不建立 `(teacher_id, grade_id)`、`(teacher_id, class_id)` 唯一约束；后者会错误阻止跨班/跨年级任课。

## 3. Teacher 状态机与操作

```text
(create) -> ACTIVE
ACTIVE --deactivate--> LEFT
LEFT   --restore----> ACTIVE
ACTIVE/LEFT --delete(no references)--> deleted_at != null
```

| 动作 | 前置状态 | 写入 | 账号联动 | 事件/日志 | 失败 |
|------|----------|------|----------|-----------|------|
| 创建 | 无 | 插入 `ACTIVE` | 可选调用 D08 开通 | `teacher.created`；账号结果由 D08 审计 | 格式/重复 400/409 |
| 编辑 | 任意未删除 | `name/gender/phone/version` | 不改账号 | 无强制事件 | 版本冲突 409 |
| 退校 | `ACTIVE` | `status=LEFT` | T2 内停用账号并撤销会话；无账号则幂等无操作 | `teacher.deactivated`；`operation_log` | 已退校 409；任一步失败全回滚 |
| 恢复 | `LEFT` | `status=ACTIVE` | 不自动启用账号 | `operation_log` | 已在职 409 |
| 删除 | 任意未删除 | `deleted_at=now()` | 账号存在即视为引用并拒绝，不进入停用 | `operation_log(DELETE)` | 有引用 409，记录保留 |

状态迁移唯一允许 `ACTIVE -> LEFT` 与 `LEFT -> ACTIVE`；其他状态组合返回 `STATE_CONFLICT`。

补充规则：

- 编辑请求不包含 `employeeNo`；服务端若收到该字段应返回字段级 `VALIDATION_ERROR`，不得静默改名。
- 退校与恢复均要求 `version`；并发写使用 `UPDATE ... WHERE version = $expected`，零行即 `VERSION_CONFLICT`。
- 恢复不重置工号、不重建账号、不自动启用账号；账号启用由 D08 显式完成（A-02、M-22）。
- 删除是逻辑删除；列表默认过滤 `deleted_at IS NOT NULL`，不提供恢复已删除教师的 API。

## 4. 引用保护

删除教师前在同一事务内汇总引用；任一类计数大于 0 即返回 `409 REFERENCE_PROTECTED`，`details` 列出引用类型与数量。

| 引用 | 所有者 | D03 检查方式 | 本卡验证 |
|------|--------|----------------|----------|
| 任课 | resource | `teaching_assignment.teacher_id`，仅未删除记录 | 是（TC-BD-020） |
| 班主任 | registry | `registry.ClassQueryService.countByHeadTeacher(teacherId)` | 是 |
| 登录账号 | identity | `identity.AccountQueryService.findByTeacherId(teacherId)` | 契约校验；由 D08 实现 |
| 合班/走班 | resource | `combined_class.teacher_id`、`walking_group.teacher_id` | D04 提供查询桩 |
| 历史课次/未排清单/冲突 | timetable | `timetable.ReferenceQueryService.countTeacherReferences(teacherId)` | D05/D06 提供查询桩 |

A-02 明确规定“有任课、班主任、账号等引用时拒绝删除”。因此账号存在时不得删除教师；退校是停用账号且保留主数据的唯一常规路径。该口径优先于旧 XW-08 中“删除后停用账号”的表述。

## 5. 任课约束语义

### 5.1 禁排 `forbiddenSlots`

业务规则限定的不可排时段。来源可以是校级/科目/场地规则；对自动排课和人工调课均为硬约束。D05 冲突明细必须标记来源为“禁排”。

### 5.2 免排 `exemptedSlots`

教师主动配置的免排时段。对自动排课作为不可占用输入；D05 冲突明细必须标记来源为“免排”。是否允许人工覆盖只能由 D05 的冲突处置流程决定，D03 不将其并入禁排。

### 5.3 保存校验

1. 教师必须存在、`status=ACTIVE` 且 `deleted_at IS NULL`。
2. 科目和班级必须存在且未删除；通过 registry query service 校验。
3. 场地可选；有值时必须存在且 `status=AVAILABLE`。
4. `weeklyPeriods` 为 `1..99` 的整数；DB 最低约束为 `>=1`。
5. 连堂偏好只允许三个契约枚举值。
6. 两个 slot 数组分别为空数组或合法 `Slot[]`；非法 weekday/period 返回字段级错误。
7. 有效唯一键冲突返回 `DUPLICATE`；并发创建由部分唯一索引兜底。
8. 不读取、不比较班级所属年级；跨年级任课必须成功。

## 6. API 设计

所有端点 Admin only，需会话与 CSRF；写请求携带 `version`。删除类操作还需 `?version=` 查询参数，保持与主数据并发约定一致。

| 方法 | 路径 | 说明 | 关键失败 |
|------|------|------|----------|
| GET | `/teachers` | 分页教师列表：工号、姓名、性别、手机、状态、版本 | 401/403 |
| POST | `/teachers` | 创建；可选 `provisionAccount` | 格式 400；重复 409 |
| PATCH | `/teachers/:id` | 编辑姓名/性别/手机；工号不可改 | 版本/状态 409 |
| POST | `/teachers/:id/deactivate` | 退校 | 已退校 409；联动失败回滚 |
| POST | `/teachers/:id/restore` | 恢复在职 | 已在职 409 |
| DELETE | `/teachers/:id?version=` | 无引用时逻辑删除 | 引用保护 409 |
| GET | `/teachers/:id/assignments` | 教师任课分页列表 | 404 |
| POST | `/teaching-assignments` | 新建任课 | 字段 400；重复 409 |
| PATCH | `/teaching-assignments/:id` | 编辑任课 | 版本 409 |
| DELETE | `/teaching-assignments/:id?version=` | 逻辑删除任课 | 版本 409 |

创建教师请求：

```json
{
  "employeeNo": "T1001",
  "name": "张老师",
  "gender": "FEMALE",
  "phone": "13800001234",
  "provisionAccount": true
}
```

退校、恢复请求均为 `{ "version": 1 }`。任课创建请求字段与 `TeachingAssignment` 一致，响应返回完整实体及递增后的 `version`。

### 6.1 错误契约

| 场景 | HTTP / code | details |
|------|-------------|---------|
| `A1001`、`1001` | `400 VALIDATION_ERROR` | `employeeNo`: “工号格式应为 T 加数字” |
| 重复 `T1001` | `409 DUPLICATE` | `employeeNo`: “该工号已存在” |
| 有任课/班主任/账号引用 | `409 REFERENCE_PROTECTED` | `references: [{ type, count }]` |
| 已退校再次退校 | `409 STATE_CONFLICT` | “该教师已退校” |
| 已在职再次恢复 | `409 STATE_CONFLICT` | “该教师已在职” |
| 版本过期 | `409 VERSION_CONFLICT` | 客户端刷新提示 |
| 周课时为 0/负数 | `400 VALIDATION_ERROR` | `weeklyPeriods`: “每周课时至少为 1” |
| 班级/科目无效 | `400 VALIDATION_ERROR` | 对应字段 |

## 7. 账号开通联动（D08）

resource 定义端口，identity 提供实现；resource 不 import `sys_user` repository，也不执行 `INSERT/UPDATE sys_user`。

```ts
export interface TeacherAccountPort {
  provisionWithinTransaction(
    tx: Tx,
    input: { teacherId: string; username: string; displayName: string },
  ): Promise<{ userId: string; username: string; alreadyExists: boolean }>;

  disableWithinTransaction(tx: Tx, teacherId: string): Promise<void>;
}
```

- `username = teacher.employeeNo`（沿用 D08“教师账号 username = employeeNo”契约）。
- 创建教师且 `provisionAccount=true` 时，resource 在同一事务内插入教师并调用 `provisionWithinTransaction`；任一步失败回滚教师与账号。
- D08 以 `teacher_id` 唯一约束和用户名唯一索引保证幂等；重复开通返回既有账号并标记 `alreadyExists=true`，不新增 `sys_user`。
- 直接调用 `POST /teachers/{teacherId}/provision-account` 同样幂等，供历史教师补开通或失败重试。
- 不向 resource 返回密码哈希；一次性初始密码仅在 D08 响应中出现。
- 退校调用 `disableWithinTransaction`，由 identity 停用账号并撤销会话；恢复不调用 enable。
- 删除前若账号存在，identity 查询结果计入引用保护并拒绝删除。

### 7.1 D08 接口桩验收

D03 可在 D08 未完成时使用测试桩，但桩必须满足：

1. 首次开通返回 `alreadyExists=false` 并记录一条账号。
2. 相同 `teacherId` 再次调用返回 `alreadyExists=true`，账号数量不变。
3. `disableWithinTransaction` 对无账号教师为幂等无操作。
4. 任一调用抛错时整个 resource 事务回滚。

## 8. 查询服务导出

### 8.1 TeacherQueryService

```ts
export interface TeacherSnapshot {
  teacherId: string;
  employeeNo: string;
  name: string;
  status: 'ACTIVE' | 'LEFT';
  version: number;
}

export interface TeacherQueryService {
  findById(teacherId: string): Promise<TeacherSnapshot | null>;
  findActiveById(teacherId: string): Promise<TeacherSnapshot | null>;
  listActiveByIds(teacherIds: string[]): Promise<TeacherSnapshot[]>;
  countReferences(teacherId: string): Promise<Array<{ type: string; count: number }>>;
}
```

消费者：registry（班主任校验）、identity（账号开通读取工号/姓名）、timetable（排课读取教师状态/姓名）。默认不返回已逻辑删除教师。

### 8.2 AssignmentQueryService

```ts
export interface TeachingAssignmentSnapshot {
  assignmentId: string;
  teacherId: string;
  teacherEmployeeNo: string;
  teacherName: string;
  teacherStatus: 'ACTIVE' | 'LEFT';
  teacherVersion: number;
  subjectId: string;
  subjectName: string;
  classId: string;
  className: string;
  gradeId: string;
  gradeName: string;
  studentCount: number;
  venueId: string | null;
  venueName: string | null;
  venueCapacity: number | null;
  weeklyPeriods: number;
  consecutivePreference: 'NONE' | 'PREFERRED' | 'REQUIRED';
  forbiddenSlots: Slot[];
  exemptedSlots: Slot[];
  assignmentVersion: number;
}

export interface AssignmentQueryService {
  findById(assignmentId: string): Promise<TeachingAssignmentSnapshot | null>;
  listByTeacher(teacherId: string): Promise<TeachingAssignmentSnapshot[]>;
  listSchedulingAssignments(): Promise<TeachingAssignmentSnapshot[]>;
}
```

`listSchedulingAssignments()` 只返回 `teaching_assignment.deleted_at IS NULL` 且教师未删除的记录；`teacherStatus` 必须随快照返回，D05 默认仅把 `ACTIVE` 教师纳入排课，`LEFT` 教师的历史记录保留供审计/统计。

## 9. D05 排课快照

D05 每轮排课开始时通过 `AssignmentQueryService.listSchedulingAssignments()` 获取不可变输入快照。快照字段：

| 分组 | 字段 | 用途 |
|------|------|------|
| 任课身份 | `assignmentId`、`assignmentVersion` | 排课单元标识与变更追踪 |
| 教师 | `teacherId`、`teacherEmployeeNo`、`teacherName`、`teacherStatus`、`teacherVersion` | 教师冲突键与状态过滤 |
| 科目 | `subjectId`、`subjectName` | 课程与规则映射 |
| 班级 | `classId`、`className`、`gradeId`、`gradeName`、`studentCount` | 班级冲突键、容量校验；年级仅展示 |
| 场地 | `venueId`、`venueName`、`venueCapacity` | 场地冲突与容量硬约束 |
| 课时 | `weeklyPeriods` | 生成课次数量 |
| 连堂 | `consecutivePreference` | 连堂软/硬偏好 |
| 禁排 | `forbiddenSlots` | 业务禁排硬约束，来源标记“禁排” |
| 免排 | `exemptedSlots` | 教师免排硬约束，来源标记“免排” |

D05 不读取 `teaching_assignment` 表、不按年级分组教师、不把 `forbiddenSlots` 与 `exemptedSlots` 合并为单一数组。跨年级任课直接表现为多条快照，教师冲突只按 `(teacherId, weekday, period)` 判定。

## 10. 领域事件

| 事件 | 触发 | 消费者 | payload 要点 |
|------|------|--------|---------------|
| `bc.resource.teacher.created` | 教师创建 | 无 | `teacherId`、`employeeNo`、`name` |
| `bc.resource.teacher.deactivated` | `ACTIVE -> LEFT` | identity、timetable | `teacherId`、`status=LEFT`、通用事件字段 |
| `bc.resource.assignment.configured` | 任课创建/编辑/删除 | timetable | `assignmentId`、`teacherId`、`subjectId`、`classId`、`changeType=CREATED/UPDATED/DELETED` |

事件与业务写入/outbox 同事务。退校事件不得作为停用账号的唯一手段：resource 必须在同一事务内调用 identity 命令，事件仅用于后续通知与缓存失效。恢复不新增事件；D05 在每轮排课开始时读取教师状态，不复用旧快照。若后续引入缓存，必须新增恢复事件并登记契约变更。

## 11. 前端 P07 设计

路由 `/teachers`，页面标题「教师与任课约束」。

- 教师表：工号、姓名、性别、手机号、状态、登录账号状态（来自 D08 查询）、操作。
- 任课表：教师、科目、班级、场地、每周课时、连堂偏好、禁排时段、免排时段、操作。
- 新增教师抽屉：工号、姓名、性别、手机号、一键开通账号；工号输入提示 `T+数字`。
- 编辑教师抽屉：工号只读；姓名、性别、手机号、版本；不出现在职状态字段，状态只能通过退校/恢复动作改变。
- 退校：二次确认说明“保留主数据并停用登录账号；恢复时不自动启用账号”。
- 恢复：二次确认说明“恢复在职状态；登录账号仍需在用户管理中单独启用”。
- 删除：二次确认说明“仅无任课、班主任、账号等引用时可删除；本操作逻辑删除且不可恢复”。
- 新增/编辑任课抽屉：教师、科目、班级、场地、周课时、连堂偏好、禁排时段、免排时段；班级按年级分组展示但不限制选择。
- 禁排和免排使用两个独立时段选择器、两个独立标签颜色和文案；不得在一个控件中保存后拆分。
- 删除任课：二次确认并提示影响；成功后刷新任课列表。
- 账号开通返回 `alreadyExists=true` 时提示“该教师已有登录账号，未重复创建”，不得显示失败。
- 所有 409 错误保留页面输入并提示引用/版本/状态原因；表单错误聚焦第一个字段。

## 12. 验证设计

### 12.1 工号

```sql
-- 合规
INSERT INTO teacher (employee_no, name) VALUES ('T1001', '测试教师');
-- 以下必须被 CHECK 拒绝
INSERT INTO teacher (employee_no, name) VALUES ('A1001', '测试教师');
INSERT INTO teacher (employee_no, name) VALUES ('1001', '测试教师');
-- 以下必须被唯一约束拒绝
INSERT INTO teacher (employee_no, name) VALUES ('T1001', '另一教师');
```

API 层对应断言：前两类返回 400，重复返回 409，且 `teacher` 行数不增加。

### 12.2 引用与状态

1. 创建 `T1001` 与一条任课；删除教师必须 409，教师与任课均保留。
2. 退校后 `status=LEFT`、`deleted_at IS NULL`、任课保留；恢复后 `status=ACTIVE`。
3. 退校调用 D08 失败时，教师仍 `ACTIVE`，无部分写入。

### 12.3 任课字段

保存 `forbidden_slots=[{"weekday":1,"period":1}]`、`exempted_slots=[{"weekday":2,"period":5}]`，分别查询两列并断言值未合并、未互换。

### 12.4 跨年级

为同一教师创建高一年级与高二年级两个班级的任课，均须成功；Schema 与 API 校验均不得出现 `grade_id` 一致性检查。

### 12.5 静态设计测试

`backend/tests/teacher-assignment-design.test.ts` 读取设计迁移草案与契约，验证：

- 工号 CHECK 与唯一约束存在；
- 两个 slot 字段分别存在；
- 任课表无年级字段；
- restore 与 idempotent account 契约存在；
- 禁排/免排数组约束存在。

## 13. 交付与后续卡

- D05：消费第 8/9 节快照；负责禁排/免排的实际排课执行与冲突来源展示。
- D08：实现 `TeacherAccountPort`、幂等开通、账号停用及 `alreadyExists` 反馈。
- D09：复用第 5.3 节字段校验，输出行级错误。
- INT-01/INT-02：验证删除保护、账号联动、事件事务边界，并把实现差异回写契约。
