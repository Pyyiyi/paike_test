# 跨域写入点与事务边界

> contractVersion: 1.0.0  
> 依据：`docs/knowledge/dependency-graph.yaml`、`docs/knowledge/phase-contracts/p0~p3`、`conventions.md` §5.1  
> 冻结规则：任何用例不得直接写其他上下文拥有的表；跨域强一致必须经对方导出的应用服务，在同一数据库事务内完成。事件与安全审计只承担通知/留痕，不替代强一致写入。

---

## 1. 表所有权与合法写入口

| 上下文 | 拥有的表 | 合法写入口 |
|--------|----------|------------|
| registry | `semester`、`schedule_template`、`schedule_template_version`、`calendar_exception`、`grade`、`class`、`subject`、`subject_period_rule` | registry 应用服务 |
| resource | `teacher`、`teaching_assignment`、`venue`、`combined_class`、`combined_class_member`、`walking_group`、`walking_group_member` | resource 应用服务 |
| timetable | `timetable_plan`、`lesson`、`lesson_class`、`unscheduled_lesson`、`conflict_detail`、`conflict_ignore`、`adjustment_history` | timetable 应用服务 |
| governance | `operation_log`、`semester_archive` | governance 应用服务；`operation_log` 可经共享内核 `writeOperationLog` 在同一业务事务写入 |
| identity | `sys_user` | identity 应用服务 |
| exchange | `import_batch`、`print_template` | exchange 应用服务 |
| shared | `sys_migration`、`sys_session`、`sys_login_attempt`、`sys_config`、`sys_controlled_vocabulary`、`sys_outbox_event`、`sys_audit_log` | 共享内核导出函数；业务模块不得复制其 SQL |

**禁止项**

- 禁止跨上下文 import 对方的 repository、mapper 或直接执行对方表的 DML。
- 禁止通过领域事件实现本应强一致的跨域状态切换；事件只用于审计、缓存失效和后续通知。
- 禁止在事务提交后补写 `operation_log` 或 `sys_outbox_event`。

---

## 2. 统一事务模式

| 模式 | 适用场景 | 边界与失败规则 |
|------|----------|----------------|
| T1 单聚合本地事务 | 单上下文、单聚合主数据增删改 | 业务行 + 同一事务内的操作日志/安全审计 + outbox；失败全部回滚 |
| T2 编排型强一致事务 | 学期存档、学期切换、教师退校联动、教师开通账号 | 由一个应用服务开启事务，顺序调用各域导出的 command/query service；任一失败整笔回滚 |
| T3 引用检查 + 本地写入 | 删除保护、引用关系配置 | 先在同一事务内调用各域 query service 检查引用，再写本域；领域外键是最终完整性兜底 |
| T4 逐行导入事务 | 批量导入 | 每个合法数据行使用独立事务写入目标上下文；批次进度单独提交；基础设施故障将批次标记 `FAILED`，不得声称整批成功 |
| T5 只读编排 + 审计 | 导出、打印预览/渲染、课表视图、统计 | 读取各域 query service，不写业务表；导出/打印只写 `sys_audit_log`，打印模板维护按 T1 |

所有写事务必须满足：

1. 乐观锁失败时零业务写入、零业务日志、零 outbox。
2. 操作日志与业务写入同事务；日志失败则业务回滚。
3. outbox 与业务写入同事务；投递失败留在 outbox 重试，不回滚已提交业务。
4. 批量调课、发布/覆盖、存档、切换、导入提交均遵守「整批全成或全不成」；导入按 T4 的行级边界例外。

---

## 3. 跨域写入点清单

| ID | 用例/入口 | 发起上下文 | 本事务写入的表 | 跨域查询/命令 | 事件与日志 | 事务边界与零写入规则 |
|----|-----------|------------|----------------|---------------|------------|----------------------|
| XW-01 | 新增/编辑班级并指定班主任 | registry | `class`；`sys_outbox_event`；必要时 `operation_log` | `resource.TeacherQueryService` 校验教师存在且在职 | `bc.registry.class.created`（新建时） | T1/T3；教师无效或版本冲突时 `class` 不写 |
| XW-02 | 新增/编辑/删除任课 | resource | `teaching_assignment`（删除写 `deleted_at`）；`sys_outbox_event` | `registry.ClassQueryService`、`registry.SubjectQueryService`；场地由 resource 自身校验 | `bc.resource.assignment.configured`（`changeType=CREATED/UPDATED/DELETED`） | T1/T3；班级/科目无效、重复或版本冲突时整笔回滚 |
| XW-03 | 新增/编辑合班课 | resource | `combined_class`、`combined_class_member`；`sys_outbox_event` | `registry.ClassQueryService` 校验全部成员班级 | `bc.resource.combined-class.configured` | T1/T3；成员班级任一无效时父记录与成员均不写 |
| XW-04 | 新增/编辑走班配置 | resource | `walking_group`、`walking_group_member`；`sys_outbox_event` | `registry.ClassQueryService`、`registry.SubjectQueryService` 校验 | `bc.resource.walking-group.configured` | T1/T3；任一成员/科目无效时整笔回滚 |
| XW-05 | 删除作息模板 | registry | `schedule_template.deleted_at`；`operation_log` | 查询 `semester.schedule_template_version_id` 引用 | 删除操作日志 | T3；被任一学期钉扎时返回 `REFERENCE_PROTECTED`，零写入 |
| XW-06 | 删除年级/班级/科目/教师/场地/合班/走班 | 对应主数据上下文 | 本域 `deleted_at`；`operation_log` | registry/resource/timetable/identity 各 query service 汇总引用 | 删除操作日志 | T3；存在任课、班主任、合班、课次、账号等引用时拒绝且零写入 |
| XW-07 | 教师退校 | resource | `teacher.status='LEFT'`；`sys_outbox_event`；`operation_log` | 同事务调用 identity `DisableTeacherAccount` 写 `sys_user.status='DISABLED'` 并撤销 `sys_session` | `bc.resource.teacher.deactivated` | T2；teacher 状态、账号停用、会话撤销任一失败全部回滚 |
| XW-08 | 删除教师（无任何引用） | resource | `teacher.deleted_at`；`operation_log` | 跨域引用检查见 XW-06；identity 账号存在即计入引用并拒绝，不写 `sys_user` | 删除操作日志 | T3；有任课、班主任、账号等引用时返回 `REFERENCE_PROTECTED` 且零写入 |
| XW-09 | 教师一键开通账号 | identity | `sys_user`（含 `teacher_id`）；`sys_audit_log`；`sys_outbox_event` | `resource.TeacherQueryService` 读取工号/姓名/状态 | `bc.resource.teacher.account-provisioned`；安全审计 | T2；账号插入、教师关联、审计、outbox 同一事务；重复开通为幂等读取 |
| XW-10 | 批量开通教师账号 | identity | 每名教师一行 `sys_user`；`sys_audit_log`；`sys_outbox_event` | 批量读取 `resource.TeacherQueryService` | 每个成功账号一条 provisioned 事件 | 逐账号独立事务；失败账号不影响已成功账号；返回一次性凭据 CSV |
| XW-11 | 停用/启用/重置密码/角色变更 | identity | `sys_user`、`sys_session`（撤销时）；`sys_audit_log`、`sys_outbox_event` | 角色变更时读取 resource 教师关联 | `bc.identity.user.disabled` / `bc.identity.user.role-changed` | T1/T2；最后一个启用 Admin 保护与不可停用自己先校验，失败零写入 |
| XW-12 | 学期存档 | governance | `semester.status='ARCHIVED'`、当前 `timetable_plan.status='ARCHIVED'`、`semester_archive`、`operation_log`、`sys_outbox_event` | `registry.SemesterLifecycleService`、`timetable.PlanLifecycleService`、`timetable.PlanQueryService` | `bc.timetable.plan.archived`、`bc.registry.semester.status-changed` | T2；无 `PUBLISHED` 方案返回 409；学期、方案、存档、日志、outbox 同一事务 |
| XW-13 | 切换当前学期：`DISCARD` | governance | 目标/旧 `semester.is_current`；删除未保存草稿（如有）；`operation_log`、`sys_outbox_event` | `timetable.PlanLifecycleService` 丢弃草稿；`registry.SemesterLifecycleService` 切换当前值 | 学期状态事件、操作日志 | T2；目标学期 `ARCHIVED` 或版本不符时整笔回滚 |
| XW-14 | 切换当前学期：`SAVE` | governance | 草稿方案及课次/冲突结果、`semester.is_current`、`operation_log`、`sys_outbox_event` | `timetable.PlanLifecycleService` 校验 `planVersion` 并保存草稿后切换 | 学期状态事件、操作日志 | T2；草稿保存失败则不切换；同一事务先清旧 `is_current` 再设新值 |
| XW-15 | 切换当前学期：`CANCEL` | governance | 无 | 仅检查草稿是否存在 | 无 | 返回 200 且零写入；不得创建日志或 outbox |
| XW-16 | 生成/重新生成课表 | timetable | `timetable_plan` 结果字段、`lesson`、`lesson_class`、`unscheduled_lesson`、`conflict_detail`、`operation_log`、`sys_outbox_event` | registry/resource 的 query services 读取一次输入快照 | `bc.timetable.plan.generated` | T1；先替换旧结果再写入新结果，失败回滚到原方案；跨域依赖只读 |
| XW-17 | 发布/覆盖发布 | timetable | 新方案 `PUBLISHED`；旧正式方案 `SUPERSEDED`；`operation_log`、`sys_outbox_event` | 查询学期未存档、当前正式方案 | `bc.timetable.plan.published`；操作日志 `PUBLISH` / `OVERWRITE` | T1；新旧两个方案状态在同一事务切换，任一失败全部回滚 |
| XW-18 | 只本次忽略冲突 | timetable | `conflict_detail.resolution='IGNORED_ONCE'`、`timetable_plan.has_manual_exemption`、`conflict_ignore`、`operation_log`、`sys_outbox_event` | 无跨域写；读取冲突可归因配置 | `bc.timetable.conflict.ignored-once`；操作日志 | T1；不可忽略类型先拒绝，配置表零写入 |
| XW-19 | 批量调课/撤销/重做 | timetable | `lesson`、`lesson_class`、`timetable_plan.version`、`adjustment_history`、`operation_log`、`sys_outbox_event` | 只读当前方案与锁定状态 | `bc.timetable.lesson.moved`；操作日志 `ADJUST` | T1；整批校验后写入；任一冲突、锁定或存档状态不满足则整组零写入 |
| XW-20 | 预排课次/锁定/解锁 | timetable | `lesson`、`lesson_class`、`timetable_plan.version`、`operation_log` | 只读主数据与方案状态 | 操作日志 | T1；非草稿或锁定冲突时零写入 |
| XW-21 | 导入单个合法数据行 | exchange → registry/resource | 目标上下文业务表、目标上下文 outbox；本行错误以批次进度记录 | 调用 registry/resource 对应应用服务；不允许直接 DML | `bc.exchange.import.completed` 在批次完成时一次发布 | T4；每行独立事务；重复键按非法行；未知列忽略；日志只在导入提交时写一次 `IMPORT` |
| XW-22 | 导入批次收口 | exchange | `import_batch` 终态与错误摘要；`operation_log`；`sys_outbox_event` | 汇总逐行结果 | `bc.exchange.import.completed`；操作日志 `IMPORT` | 批次收口事务；基础设施故障时批次 `FAILED`，已成功行不回滚但明确返回部分结果 |
| XW-23 | Excel 导出 | exchange | 仅 `sys_audit_log` | registry/resource/timetable/statistics query services | `bc.exchange.export.completed`（审计/通知） | T5；不写业务表、不写 `operation_log`；文件不落库 |
| XW-24 | 打印模板维护 | exchange | `print_template`、`sys_audit_log`；必要时 `operation_log` | 无跨域写 | 安全审计 | T1；预设模板不可删；版本冲突零写入 |
| XW-25 | 打印预览/渲染 | exchange | 仅 `sys_audit_log` | timetable/registry/statistics query services 读取同一数据源 | `bc.exchange.print.rendered` | T5；预览与 render 输出同一 PDF；一次性签名 token 60 秒 |
| XW-26 | 操作日志写入（全部关键操作） | 发起业务上下文 | `operation_log` | 经共享内核 `writeOperationLog`；governance 提供查询模型，不提供跨域写 repository | `bc.governance.operation.logged` | 与业务写入同事务；日志失败业务回滚 |
| XW-27 | 安全审计写入（认证/账号/越权/导出/打印） | identity/shared | `sys_audit_log` | 共享内核 `writeSecurityAudit` | 无单独业务事件 | 与对应安全操作同事务或失败操作即时追加；追加写，无清理任务 |
| XW-28 | 领域事件写入（所有生产者） | 各上下文 | `sys_outbox_event` | 无跨域命令 | 本文件 §3 各事件 | 与业务写入同事务；提交后 dispatcher 至少一次投递，消费者按 `eventId` 幂等 |

`POST /teachers` 且 `provisionAccount=true` 时，resource 在同一 T2 事务内先写教师，再调用 identity `ProvisionTeacherAccount`；identity 独占 `sys_user` 写入，任一失败全部回滚。复用 `alreadyExists=true` 结果，不重复插入账号。

---

## 4. 事务边界重点

### 4.1 学期存档

同一事务内完成以下五类写入，缺一不可：

1. `semester.status → ARCHIVED`
2. 当前 `PUBLISHED` 的 `timetable_plan.status → ARCHIVED`
3. 插入唯一 `semester_archive` 快照索引
4. 插入 `operation_log(module='ARCHIVE')`
5. 插入 `bc.timetable.plan.archived` 与 `bc.registry.semester.status-changed` outbox

前置条件：存在 `PUBLISHED` 方案。失败返回 `409 STATE_CONFLICT` 且零写入。

### 4.2 学期切换

`SAVE`、`DISCARD`、`CANCEL` 三种分支必须在任何业务写入前确定。`CANCEL` 零写入；`SAVE` 的草稿版本校验与 `is_current` 切换同事务；`DISCARD` 的未保存草稿删除与切换同事务。

### 4.3 教师账号联动

教师退校引发的账号停用与会话撤销不依赖异步事件；resource 在同一事务内调用 identity 导出的应用命令。`bc.resource.teacher.deactivated` 仅用于通知 timetable/identity 的后续缓存与审计，不得作为停用的唯一手段。A-02 规定账号引用阻止教师删除，因此删除路径不调用账号停用命令；停用账号应走退校。

### 4.4 导入

- 单行边界：一行合法数据的目标业务写入、目标 outbox（如有）与行结果共同提交。
- 批次边界：批次终态、错误摘要、一次 `IMPORT` 操作日志和一次完成事件在收口事务中写入。
- `PARTIAL` 表示部分行成功；`FAILED` 表示基础设施故障或文件级拒绝。
- 超 5000 行或 20 MB 时文件级拒绝，零行写入。

### 4.5 删除保护

跨域引用检查必须在写入 `deleted_at` 前完成；查询与写入处于同一事务。数据库外键与唯一约束负责最终一致性兜底。返回 `REFERENCE_PROTECTED` 时，业务行、日志和 outbox 均不得写入。

---

## 5. 跨域只读依赖（不产生写入）

以下依赖只允许 query service，不构成跨域写入：

- timetable → registry：学期、模板、班级、科目、校历。
- timetable → resource：教师、任课、场地、合班、走班。
- statistics → timetable/resource：正式课表与教师主数据。
- exchange → registry/resource/timetable：导入/导出/打印的数据来源。
- governance → registry/timetable：存档与切换的状态查询。
- identity → resource：开通账号时读取教师工号与姓名。

这些调用不得 import 对方 repository，不得在同一 SQL 中直接 join 对方私有表形成写路径。
