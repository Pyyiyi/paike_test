# D07 操作日志、学期存档与切换设计

> 状态：设计态。本文定义业务操作日志、日志查询、学期存档、存档只读和当前学期切换契约；不包含业务实现、页面实现或已执行测试结果。
> 权威输入：PRD F18/F19、§5、D12/D16、R-026、R-039~R-041、A-19/A-20、M-17/M-19/M-20、`p3-contracts.md` §3.1、D05 方案状态机。

## 1. 范围、依赖与不变量

### 1.1 范围

- 七类关键操作的统一留痕契约、共享内核写入适配与 Admin 日志查询。
- `operation_log`、`semester_archive` 与 `0030_governance.sql` 设计迁移。
- 学期存档前置检查、跨域事务编排、存档摘要、归档只读守卫。
- 当前学期切换、DRAFT 草稿三选一（SAVE / DISCARD / CANCEL）与目标学期守卫。
- `/logs`、`/archive` 的页面、确认文案和端到端验证设计。
- TC-AP-007、TC-LG-001、TC-LG-002、TC-LG-003、TC-LG-004、TC-LG-005、TC-CM-003、O-LG-001-PERM 的静态设计覆盖。

### 1.2 非范围

- 不实现 D07 的后端路由、repository、应用服务、Vue 页面或 E2E。
- 不把 `0030_governance.sql` 直接放入 `migrations/`；实现轮次按设计文件落库。
- 不实现 D05 排课方案生命周期；D07 只冻结其存档/草稿方法契约。
- 不实现 D06 调课；D07 只规定调课保存必须写 `ADJUST` 日志与存档态 409。
- “永久留存”不宣称可由有限测试证明；按 A-20 以“无删除路径 + 追加写 + 跨重启可查”验收。

### 1.3 依赖状态

| 依赖 | 当前基线 | D07 使用方式 |
|------|----------|--------------|
| D01 学期生命周期 | 已实现 `SemesterLifecycleService`，可写学期状态、日志和状态事件 | 存档调用 `archive`，切换调用 `switchCurrent`；D07 不直写 `semester` |
| D05 方案生命周期 | 设计态，已冻结 `DRAFT/PUBLISHED/SUPERSEDED/ARCHIVED` | 调用 `PlanQueryService`、`PlanLifecycleService`；D07 不直写 `timetable_plan`/`lesson` |
| D06 调课 | 后续卡 | 调课保存写 `ADJUST`；存档后由方案/学期守卫拒绝 |
| P0-01 outbox | 已实现 | 所有领域事件与业务写入同事务 `appendEvent` |
| P0-01 操作日志内核 | 已实现 `writeOperationLog` | 业务模块只经共享内核写 `operation_log` |
| D08 权限 | 设计态，Admin/Teacher 边界已冻结 | D07 全部治理端点仅 Admin；Teacher 403 |

> 实现 D07 前必须由 D05 导出方案查询/生命周期服务。本文给出最小方法契约，禁止 D07 直接更新 timetable 私有表。

### 1.4 强制不变量

1. 七类关键操作每次成功执行恰好新增一条 `operation_log`；业务写入失败时不得留下孤立日志。
2. 日志只追加：无更新/删除 API，无自动清理或归档删除任务，数据库触发器拒绝 UPDATE/DELETE。
3. `action` 与 `content` 必须为中文可读文案；不得保存错误码、英文枚举或 SQL。
4. 存档必须具备 `PUBLISHED` 正式方案；不满足时零写入并返回 `409 STATE_CONFLICT`「请先发布正式课表再存档」。
5. 学期存档、正式方案存档、`semester_archive`、日志与 outbox 必须同事务提交或全部回滚。
6. 已存档学期的业务写操作一律 `409 STATE_CONFLICT`；查看、导出和日志查询保持可用。
7. `semester_archive` 与已存档方案是不可变快照；存档后不得更新摘要、课次或日志。
8. 切换前必须先确定草稿处置；未传选择返回 `409 DRAFT_EXISTS`。`CANCEL` 不写业务表、日志或 outbox。
9. 目标学期为 `ARCHIVED` 时拒绝切换；不得把 `is_current` 指向已存档学期。
10. 跨学期查询必须显式带 `semesterId` 或目标 ID，不存在“全学期串读”的默认路径。

## 2. 数据模型

### 2.1 迁移草案

| 迁移 | 内容 | 设计文件 |
|------|------|----------|
| `0030_governance.sql` | `operation_module`、`operation_log`、索引、追加写触发器；`semester_archive` 与快照摘要约束 | `docs/knowledge/designs/0030_governance.sql` |

依赖顺序：`0001_create_shared_tables.sql`（`sys_user`/outbox 基础）→ `0020/0021`（方案与课次）→ `0030_governance.sql`。实现时不得改号或复用其他卡序号。

### 2.2 operation_log

| 字段 | 规则 |
|------|------|
| `log_id` | UUID；一次成功业务写入一个 ID |
| `operator_id` | 必填；引用 `sys_user` |
| `operator_name` | 必填；操作时姓名快照，账号改名/停用后仍可追溯 |
| `module` | `operation_module` 枚举；用于筛选和中文标签映射 |
| `action` | 必填中文动作，如「发布」「覆盖发布」「保存调课」 |
| `content` | 必填中文摘要，包含对象名称与必要数量，可直接展示 |
| `target_type` | 必填对象类型，PascalCase；七类操作必须可定位到具体对象 |
| `target_id` | 必填对象 UUID；不接受“只有文字没有对象”的日志 |
| `request_id` | 可选请求追踪 ID；不参与业务唯一性 |
| `created_at` | 服务端 `Clock` 时间；`timestamptz` |

七类关键操作与模块固定映射如下；运行时字段完整集合为“操作人、时间、模块、中文动作、中文内容、对象类型、对象 ID”。

| 关键操作 | `module` | 对象示例 | `content` 示例 |
|----------|----------|----------|-----------------|
| 删除类 | `DELETE` | 班级/教师/场地/模板 | 「删除教师「王老师」」 |
| 发布 | `PUBLISH` | 排课方案 | 「发布 2026 秋季正式课表（方案 2026秋-v4）」 |
| 覆盖方案 | `OVERWRITE` | 新排课方案 | 「覆盖发布 2026 秋季正式课表（方案 2026秋-v5）」 |
| 切换学期 | `SWITCH_SEMESTER` | 目标学期 | 「切换当前学期为「2027 春季」」 |
| 批量导入提交 | `IMPORT` | 导入批次 | 「导入教师：共 120 行，成功 118 行，失败 2 行」 |
| 学期存档 | `ARCHIVE` | 学期 | 「存档学期「2026 秋季」（方案 2026秋-v4）」 |
| 调课保存 | `ADJUST` | 调课批次/课次 | 「保存调课：2026 秋季课表共调整 3 个课次」 |

D05/D21 另有五类显式审计动作：`GENERATE`、`SAVE_AS`、`IGNORE_ONCE`、`LOCK`、`UNLOCK`。它们与七类共用同一张只追加表，但不改变 F18 的“七类关键操作”口径；TC-LG-001 执行七类操作时只应新增 7 条对应日志。

### 2.3 日志索引与只追加约束

| 索引 | 用途 |
|------|------|
| `idx_operation_log_created (created_at DESC, log_id DESC)` | 默认时间倒序、时间范围筛选、稳定翻页 |
| `idx_operation_log_operator_created (operator_id, created_at DESC, log_id DESC)` | 按操作人筛选 |
| `idx_operation_log_module_created (module, created_at DESC, log_id DESC)` | 按模块筛选 |
| `idx_operation_log_operator_module_created (operator_id, module, created_at DESC, log_id DESC)` | 操作人 + 模块组合筛选 |

- 时间以 `created_at DESC, log_id DESC` 作为确定性排序；同一 Clock 时间戳也不会翻页抖动。
- `trg_operation_log_append_only` 在 UPDATE/DELETE 前抛错，保证即使后续误加代码也无法改写历史。
- 不创建清理任务、TTL、分区删除任务或日志归档删除接口。

### 2.4 semester_archive

| 字段 | 规则 |
|------|------|
| `archive_id` | UUID 主键 |
| `semester_id` | 必填且唯一；一个学期只允许一条存档记录 |
| `plan_id` | 必填；存档时的唯一正式方案 |
| `archived_by` / `archived_at` | 存档操作人快照与时间 |
| `summary` | JSONB；冻结摘要，不允许存档后更新 |
| `created_at` | 创建时间 |

`summary` 固定包含：`semesterName`、`academicYear`、`term`、`planName`、`planVersion`、`publishedAt`、`classCount`、`lessonCount`、`unscheduledCount`、`conflictCount`、`snapshotHash`。

- `snapshotHash` 是规范化方案 + 课次 + 班级关联 + 未排清单的 SHA-256，用于证明存档后内容未变化。
- `semester_archive` 使用独立追加写触发器；没有更新/删除 API。
- 引用 `plan_id` 与 `semester_id` 不级联删除；已存档学期本身不可删除，其他未引用学期/模板删除不影响本记录（A-17 / TC-CM-003）。

## 3. 共享内核日志写入适配

业务模块统一调用：

```ts
writeOperationLog(tx, {
  operatorId, operatorName, module, action, content, targetType, targetId, requestId
}, clock): Promise<void>
```

规则：

1. 必须在业务事务的同一 `tx` 内调用；禁止提交后补写或异步补偿。
2. 一个业务命令只调用一次；成功后日志与业务行同生共死。
3. `content` 由业务应用服务用中文拼装，禁止直接拼接错误码、英文状态或异常消息。
4. `operatorName` 取当前账号快照；`requestId` 取请求上下文，可空。
5. 共享内核只负责 INSERT；不暴露 update/delete 方法，不注册清理任务。
6. 业务模块不得直接 import governance repository，也不得直接执行 `INSERT INTO operation_log`。
7. D01 的 `SemesterLifecycleService.archive/switchCurrent` 是该学期命令的日志写入点；D07 编排时不得再写第二条同命令日志。
8. D05 `PlanLifecycleService.archivePublished` 只改方案状态并追加 `bc.timetable.plan.archived`，不再写一条重复 `ARCHIVE` 日志。

## 4. 日志查询 API

| 方法 | 路径 | 规则 |
|------|------|------|
| GET | `/api/v1/operation-logs` | Admin；分页、筛选、时间倒序 |
| GET | `/api/v1/operation-logs/:logId` | Admin；详情；不存在返回 404 |

查询参数：

- `operatorId`：精确匹配 UUID。
- `from`：包含边界，`created_at >= from`。
- `to`：不包含边界，`created_at < to`。
- `module`：枚举精确匹配。
- `page` 从 1 开始，`pageSize` 默认 20、最大 100。

响应固定为 `{ data: { items, page, pageSize, total } }`；SQL 使用 `ORDER BY created_at DESC, log_id DESC`，条件全部参数化。查询结果只读，不返回可编辑标志。

前端显示：操作人、时间、模块中文标签、中文动作、内容、对象；只提供筛选、分页和详情，不提供删除/编辑/归档按钮。

## 5. 学期存档

### 5.1 前置检查

`GET /api/v1/archive-status?semesterId=` 仅 Admin，返回：

```json
{
  "data": {
    "semesterId": "uuid",
    "canArchive": true,
    "reason": null,
    "publishedPlanId": "uuid",
    "publishedPlanName": "2026秋-v4"
  }
}
```

- 同学期必须存在唯一 `PUBLISHED` 方案；不存在时 `canArchive=false`，`reason` 为中文原因。
- 已存档时 `canArchive=false`，提示「该学期已存档」。
- 检查接口只读，不写日志、不写 outbox。

### 5.2 存档事务边界

`POST /api/v1/semesters/:id/archive` 请求 `{ "confirm": true }`；未确认返回 400，不写任何数据。

事务 `T2`（跨域强一致）：

1. 通过 registry 查询服务锁定并读取目标学期；不存在 404，`ARCHIVED` 409。
2. 通过 timetable 查询服务锁定同学期 `PUBLISHED` 方案；不存在则 `409 STATE_CONFLICT`，消息固定为「请先发布正式课表再存档」，零写入。
3. 读取方案与课次统计，生成 `summary` 与 `snapshotHash`；此步骤只读。
4. 调用 `timetable.PlanLifecycleService.archivePublished(tx, planId, actor)`：正式方案 `PUBLISHED → ARCHIVED`，写 `archived_at`，追加 `bc.timetable.plan.archived`。
5. 调用 `registry.SemesterLifecycleService.archive(tx, semesterId, actor, expectedVersion?)`：学期 `→ ARCHIVED` 且 `is_current=false`，写唯一 `ARCHIVE` 日志，追加 `bc.registry.semester.status-changed`。
6. 由 governance repository 写一条 `semester_archive`；唯一键保证重复存档零写入或 409。
7. 任一服务、日志、摘要或 outbox 写入失败，全部回滚；禁止跨事务补偿。

> D07 只写 governance 自有表 `semester_archive`。学期与方案状态通过 D01/D05 应用服务写入，禁止直接 DML 他域表。

### 5.3 outbox 与幂等

同一事务至少包含：

- `bc.timetable.plan.archived { planId, semesterId, occurredBy, occurredAt }`
- `bc.registry.semester.status-changed { semesterId, fromStatus, toStatus: ARCHIVED, occurredBy, occurredAt }`

`semester_archive.semester_id` 唯一键与方案状态检查共同保证重复请求不会创建第二条存档记录。

### 5.4 存档后只读

已存档学期内以下写操作返回 `409 STATE_CONFLICT`，消息「该学期已存档，只能查看或导出」：

- 学期编辑、删除、再次存档；
- 方案新建、编辑、删除、生成、另存、发布/覆盖、冲突忽略、锁定/解锁；
- 课次预排、调课保存/撤销/重做；
- 依赖该学期的导入提交。

以下只读能力保持 200：课表五视图、统计、空闲时段、日志列表/详情、存档详情、Excel 导出、打印预览。全局主数据的新增/编辑不属于“该学期内写操作”，但删除被该学期引用的数据仍按引用保护拒绝。

存档后不得改变已存档方案、课次、`semester_archive.summary` 或历史日志；`snapshotHash` 用于静态/集成断言。

## 6. 切换当前学期与草稿三选一

### 6.1 请求契约

```json
{
  "draftResolution": "SAVE",
  "draftPlanId": "uuid",
  "planVersion": 12
}
```

- `draftResolution ∈ SAVE / DISCARD / CANCEL`；无草稿时可省略。
- `draftPlanId` 在存在多个 DRAFT 时用于指定当前编辑草稿；只有一个草稿时可省略。
- `planVersion` 用于 SAVE/DISCARD 的乐观校验；版本不一致返回 `409 VERSION_CONFLICT`。

“草稿”在服务端定义为 `timetable_plan.status='DRAFT'` 的持久化方案。浏览器尚未提交的表单不是服务端状态：客户端若选择 SAVE，必须先调用 D05 方案保存命令落库，再用返回版本调用本接口；本接口不接收整份方案 JSON。

### 6.2 决策顺序

1. 校验目标学期存在且不是 `ARCHIVED`；已存档直接 `409 STATE_CONFLICT`「已存档学期不能切换为当前学期」。
2. 通过 `PlanQueryService.listDrafts(semesterId=当前学期)` 读取 DRAFT；无草稿直接切换，忽略额外字段。
3. 有草稿且未传 `draftResolution`：`409 DRAFT_EXISTS`，消息「当前学期存在未发布草稿，请选择保存、放弃或取消」，`details.drafts` 返回 `planId/name/version/updatedAt`。
4. `SAVE`：校验草稿仍为 DRAFT 且 `planVersion` 匹配；草稿原样保留；切换。
5. `DISCARD`：校验草稿仍为 DRAFT 且 `planVersion` 匹配；调用 `PlanLifecycleService.discardDraft(tx, planId, version, actor)` 逻辑删除该草稿；切换。
6. `CANCEL`：返回 200 与当前学期，不切 `is_current`、不删草稿、不写日志、不写 outbox。
7. 多个 DRAFT 时 SAVE/DISCARD 未给 `draftPlanId` 返回 400，并要求前端明确当前编辑对象；不得猜测“最近草稿”。

### 6.3 事务与事件

成功切换在单个事务内完成：

- `registry.SemesterLifecycleService.switchCurrent(tx, targetId, actor)` 先清旧 `is_current` 再设目标，写唯一 `SWITCH_SEMESTER` 日志。
- 追加 `bc.registry.semester.current-changed { previousSemesterId, currentSemesterId, occurredBy, occurredAt }`。
- DISCARD 的草稿逻辑删除与切换同事务；SAVE 的草稿版本校验与切换同事务。
- CANCEL 在事务内只执行只读校验，不产生任何 INSERT/UPDATE/DELETE。

## 7. 权限与安全

- `/operation-logs`、`/operation-logs/:logId`、`/semesters/:id/archive`、`/semesters/:id/switch`、`/archive-status` 均为 Admin-only。
- Teacher 直接请求返回 `403 FORBIDDEN`；前端隐藏入口不是权限边界。
- 所有 POST 需要 CSRF Token；所有 `:id`、`semesterId`、`logId` 使用 UUID 校验。
- 日志不得包含密码、Cookie、CSRF Token 或异常堆栈；查询只返回白名单字段。

权限锚点：`LG-P-01` 覆盖五个治理端点的 Admin/Teacher 边界；`O-LG-001-PERM` 仍只表示永久留存不可证明子断言，不计入可执行覆盖率。

## 8. 前端设计

### 8.1 `/logs` 操作日志

- 顶部筛选：操作人下拉、开始/结束时间、模块下拉、重置。
- 表格列：时间、操作人、模块、动作、内容、对象；默认时间倒序。
- 详情抽屉展示全部白名单字段与 `requestId`；无编辑/删除按钮。
- 空状态：「没有符合条件的操作日志，请调整筛选条件」。

### 8.2 `/archive` 多学期存档与切换

- 学期列表展示名称、学年/学期、状态、正式方案、存档时间。
- 「学期存档」按钮仅在该学期有 `PUBLISHED` 时可用；二次确认标题「确认存档学期」，正文说明：
  「存档后该学期所有写操作将被拒绝，仅可查看和导出；已存档快照不会因后续删除其他学期或模板而变化。此操作不可撤销。」
- 无正式方案时展示「请先发布正式课表再存档」，点击存档不发出写请求。
- 切换学期：选择目标后先请求切换；收到 `409 DRAFT_EXISTS` 时弹出三选一：
  - 「保存草稿并切换」
  - 「放弃草稿并切换」
  - 「取消」
- 放弃分支必须再次说明将删除所选草稿；取消分支发送 CANCEL 或关闭对话框，界面不得刷新为已切换状态。
- 存档/切换成功后广播学期上下文，列表、课表、统计、日志全部按新状态刷新；不得复用前一学期缓存。

## 9. 验证设计

### 9.1 静态设计测试

`backend/tests/governance-design.test.ts` 校验：

1. `0030_governance.sql` 的字段、索引、唯一键和追加写触发器。
2. 七类模块映射、中文 `action/content` 规则与无删除/更新 API。
3. OpenAPI 的 6 个治理 operationId、`DRAFT_EXISTS`、`draftPlanId` 与 Admin 权限。
4. 存档前置中文消息、D05/D01 跨域事务步骤和两个 outbox 事件。
5. 已存档写操作 409、查看/导出放行矩阵。
6. SAVE/DISCARD/CANCEL 语义、目标 ARCHIVED 拒绝与 CANCEL 零写入。
7. 日志索引、筛选/倒序、`semester_archive` 摘要不可变与跨学期隔离。
8. 依赖图/事件契约的一致性。

### 9.2 执行轮次验收映射

| 验证步骤 | 断言 | 设计承载 |
|----------|------|----------|
| 1 | 依次执行七类操作，恰好新增 7 条且字段完整中文可读 | §2.2、§3、TC-LG-001 |
| 2 | 未发布存档 409 且状态不变 | §5.1/5.2、TC-LG-003 |
| 3 | 发布后存档成功；学期/方案 ARCHIVED；archive 一条；PATCH/生成/调课 409 | §5、TC-LG-004 |
| 4 | 无 resolution 返回 DRAFT_EXISTS；CANCEL 零写入；SAVE 保留草稿并切换 | §6、TC-AP-007 |
| 5 | 按操作人/时间筛选，倒序且无串扰 | §2.3、§4、TC-LG-002/005 |

本轮只完成设计态验证，不执行上述集成/UI 用例；执行状态保持「未执行」。

## 10. 契约修正与待实现项

1. `conventions.md` 的 `operation_module` 补齐 D05/D21 已冻结的五个值，并补录 `DRAFT_EXISTS`。
2. OpenAPI `SwitchSemesterRequest` 增加 `draftPlanId`；`SemesterArchive.summary` 冻结为明确字段。
3. 新增 `bc.registry.semester.current-changed`，避免用 `status-changed` 表达“状态未变但当前学期已切换”。
4. D01 实现轮次在 `switchCurrent` 同一事务补齐 `bc.registry.semester.current-changed`；D05 实现 `PlanLifecycleService.archivePublished/discardDraft` 与 `PlanQueryService.listDrafts`。
5. D01 现有 `archive/switchCurrent` 已写日志；D07 编排不得重复写日志。
6. D05 设计中的 `action` 值统一改为中文动作，避免英文枚举进入日志内容。
7. 实现轮次必须为 `operation_log`/`semester_archive` 增加追加写触发器，并登记 4 个日志索引。

## 11. 验收结论口径

- 本卡完成的是设计契约、迁移草案和静态验证，不代表任何 TC 已执行或通过。
- 七类日志一一对应、存档事务、只读守卫、草稿三选一和筛选倒序均已有明确接口与事务边界。
- O-LG-001-PERM 仍为永久孤儿；本卡只保证无删除路径与追加写，不声称证明“永久留存”。
