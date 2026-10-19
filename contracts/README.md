# Contracts 1.0.0

> 状态：冻结。`contracts/` 是 Phase 1–3 实现与验收的唯一接口/数据结构依据；后续变更走 INT-02 归档，不得静默偏离。

## 六件套

| 文件 | 冻结内容 |
|------|----------|
| `openapi.yaml` | Phase 0–3 共 114 个操作：6 个 P0、50 个 P1、27 个 P2、31 个 P3；请求/响应 schema、错误码、CSRF 与权限扩展 |
| `schema.sql` | 8 张共享表 + 26 张领域/应用支撑表，共 34 张；26 个 PostgreSQL enum 类型 |
| `events.yaml` | 25 个领域事件；payload、生产者、消费者、聚合类型、`schemaVersion: 1` |
| `naming.yaml` | 28 个枚举（26 个 SQL enum + 健康/错误码 API 枚举）、14 个错误码、角色、表所有权、字段字典 |
| `routes.yaml` | 28 个前端路由、菜单组、角色来源与数据范围 |
| `cross-context-writes.md` | 28 个跨域写入点 `XW-01`–`XW-28` 与事务边界 |

## 校验

```bash
npx --yes @redocly/cli@latest lint contracts/openapi.yaml
python3 contracts/validate.py
```

`validate.py` 机械校验：

- 六件套存在且版本均为 `1.0.0`。
- OpenAPI 内部 `$ref` 全部可解析，操作数与各 Phase 操作数固定。
- OpenAPI 枚举、`naming.yaml`、`schema.sql` 的 SQL enum 值逐项一致。
- SPAC §5.3 与 P2/P3 `CREATE TYPE` 和命名表无枚举冲突。
- 字段字典与 OpenAPI 实体字段集合一致，API 为 camelCase、DB 为 snake_case。
- `routes.yaml` 与 `roles.md` 导航/权限矩阵逐路由比对，并核对已存在的前端路由 meta 角色。
- `events.yaml` 与 `dependency-graph.yaml` 的生产者/消费者拓扑一致。
- `schema.sql` 表清单与 `naming.yaml` 表所有权一致（34 张）。
- `cross-context-writes.md` 包含全部 28 个写入点。

## 已登记偏差

1. `DRAFT_EXISTS` 出现在 `spac.md` §6.1 与 `p3-contracts.md` §3.1，但 `conventions.md` §3.2 漏列；契约按前两者纳入 409 错误码。
2. `DATABASE_UNAVAILABLE`（503）由已落地的 P0-03 健康检查与错误基线使用，`conventions.md` §3.2 漏列；契约纳入并用于 `GET /health`。
3. `p3-contracts.md` 的 `import_status`、`paper_size`、`paper_orientation` 是文档别名；契约统一冻结为 `conventions.md` §10 的 `import_batch_status`、`print_paper_size`、`print_orientation`，值不变。
4. `/schedule-templates/{id}/versions` 与 `/schedule-templates/versions/{versionId}`、`/import/templates/{module}` 与 `/import/{module}/preview`、`/import/batches/{batchId}` 是 Phase 契约既有路径；Redocly 的 `no-ambiguous-paths` 规则在 `redocly.yaml` 中关闭，路径本身不改。
5. OpenAPI 同时冻结 P0 认证与健康检查接口，因为 P1–P3 全部受保护端点依赖其会话、CSRF、错误与响应封装；未新增 PRD 能力。
6. `routes.yaml` 额外登记登录、强制改密、403、404 四个状态路由；它们是 P0-08 已定义页面，不是新业务入口。
7. D03 增补 `POST /teachers/{id}/restore`，补齐 PRD F5/A-02 的恢复动作；同时将任课 `weeklyPeriods` 下限收紧为 1，并登记有效任课 `(teacherId, classId, subjectId)` 唯一索引。
8. A-02 优先于旧 XW-08 表述：账号引用阻止教师删除，删除路径不执行账号停用；退校仍是账号停用与主数据保留的独立路径。
9. `bc.resource.assignment.configured` 增补必填 `changeType=CREATED/UPDATED/DELETED`，使 D05 能区分任课保存与逻辑删除。
10. D08 设计态补充：`User` 增加 `teacherName`、`version`、`lastLoginAt`；`POST /users` 返回一次性凭据（`ProvisioningResult`）；停用/启用携带 `version`；批量开通增加 `teacherIds` 请求体与 UTF-8 BOM CSV 响应；`uq_sys_user_username_lower` 大小写不敏感唯一索引登记入 `schema.sql`；`bc.identity.user.created/disabled/role-changed` 登记入 `dependency-graph.yaml`。

## 实现通知

D01–D11、INT-01/INT-02 实现时以本目录为准：

- 字段、枚举、状态、错误码、路由角色不得偏离；需要偏离时先修改契约并登记原因。
- 跨域写入只能按 `cross-context-writes.md` 的事务边界调用应用服务。
- 迁移后的实际库结构必须能由 `schema.sql` 覆盖；INT-03 从实现反写契约时保留版本号并记录差异。

## D01 实现偏差（待 INT-03 归档）

1. `DELETE /semesters/{id}` 与 `DELETE /schedule-templates/{id}` 接受可选 `?version=` 查询参数用于乐观锁；契约原 DELETE 无请求体。未传时按当前版本删除。
2. `GET /semesters/current` 在尚未设置当前学期时返回 `404 NOT_FOUND`；契约未列该响应。
3. `operation_log` 由 D07 的 `0030_governance.sql` 创建；D01 的删除/生命周期日志在表存在时写入，D07 合入后自动生效。
4. 迁移运行器允许卡片预留序号（D01=0010/0011），仍要求首号 0001 且严格递增；迁移文件序号本身未偏离约定。
5. `seed-anchors.sql` 的 `schedule_template` 冲突目标改为无目标 `ON CONFLICT DO NOTHING`，以适配 `lower(name)` 部分唯一索引；种子数据与 UUID 未变。
6. `0015_resource_venue_units.sql` 对 D02/D03 的 `teacher`/`class`/`subject` 依赖增加条件守卫：依赖迁移尚未合入时跳过合班/走班表，依赖齐全的空库仍按完整 DDL 创建。
7. `seed-anchors.sql` 的 `venue` 冲突目标改为无目标 `ON CONFLICT DO NOTHING`，以适配 `lower(name)` 部分唯一索引；种子数据与 UUID 未变。

以上偏差不改变枚举、字段、路由角色或状态语义；INT-03 从实现反写契约时一并归档。
