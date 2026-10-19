# D08 用户、角色与教师账号开通设计

> 状态：设计态。本文定义账号、角色、开通/停用/重置流程、服务端权限边界与前端交互，不包含业务实现。
> 权威输入：PRD F20/§4、`p3-contracts.md` §3.2、A-18、H-02、M-09/M-22、`contracts/` 1.0.0。

## 1. 范围与不变量

### 1.1 范围

- 用户 CRUD、角色分配、停用/启用、重置密码。
- 教师账号一键开通、批量开通与一次性凭据 CSV。
- 最后一名启用 Admin 与自身停用保护。
- 教师退校事件联动停用账号。
- P21「用户与角色」页面、开通抽屉与凭据一次性展示。
- 服务端权限边界与越权测试清单。

### 1.2 非范围

- 不实现密码哈希、会话、锁定、CSRF 或登录接口；由 P0-02/P0-08 承接。
- 不实现教师主数据 CRUD、退校/恢复；由 D03 承接，D08 只调用 `TeacherQueryService` 并订阅 `bc.resource.teacher.deactivated`。
- 不引入第二种角色、外部 IdP、LDAP、钉钉或手机号登录。
- 不返回密码哈希；不在响应中重复展示初始密码；不把密码写入日志、审计 detail、CSV 以外的文件。

### 1.3 强制不变量

1. `sys_user.username` 大小写不敏感唯一；`lower(username)` 唯一索引兜底。
2. `sys_user.teacher_id` 非空时唯一；一个教师至多一个账号；Admin 的 `teacher_id` 必须为空。
3. `role=TEACHER` 必须关联 `teacherId`，且 `username=teacher.employee_no`；`role=ADMIN` 的 `teacherId` 必须为空。
4. 角色仅 `ADMIN` / `TEACHER`；每次请求从数据库读取当前角色与账号状态，不在会话中缓存角色快照（A-18）。
5. 停用立即撤销该账号全部会话；旧会话下一次请求返回 `401`。
6. 停用/降级最后一名启用 Admin 返回 `409 STATE_CONFLICT`；停用自己返回 `409 STATE_CONFLICT`；两种情况零写入。
7. 重复开通幂等：返回既有账号并标记 `alreadyExists=true`，不新增、不改密、不重置密码。
8. 初始密码随机生成且长度不少于 12 位；只在创建/重置响应中出现一次；`mustChangePassword=true`。
9. 教师退校只停用账号，复职不自动启用；启用必须由管理员在用户管理中显式操作。
10. 所有账号管理端点仅 `ADMIN`；Teacher 调用任一管理 API 返回 `403 FORBIDDEN`。

## 2. 数据模型

### 2.1 sys_user（P0-01 建表，本卡只加索引）

| 字段 | 数据库 | API | 规则 |
|------|--------|-----|------|
| 用户 ID | `user_id uuid pk` | `userId` | 应用层生成 UUID |
| 登录名 | `username text not null` | `username` | 去首尾空格；登录与查重使用 `lower(username)`；展示保留原值 |
| 姓名 | `display_name text not null` | `displayName` | 去空格后非空 |
| 密码哈希 | `password_hash text not null` | 不返回 | Argon2id；任何 API/日志不得出现 |
| 角色 | `role user_role not null` | `role` | `ADMIN / TEACHER` |
| 状态 | `status account_status not null` | `status` | `ENABLED / DISABLED` |
| 强制改密 | `must_change_password boolean not null` | `mustChangePassword` | 新建/重置后为 `true` |
| 关联教师 | `teacher_id uuid null` | `teacherId` | Teacher 必填；Admin 必须为空 |
| 版本 | `version integer not null` | `version` | 乐观锁；成功写操作递增 |
| 最近登录 | `last_login_at timestamptz null` | `lastLoginAt` | 只读展示 |
| 时间 | `created_at / updated_at` | 不强制返回 | 触发器维护 |

### 2.2 唯一索引（设计迁移草案）

设计迁移：`docs/knowledge/designs/0031_identity_indexes.sql`。实施阶段必须按 `0031_identity_indexes.sql` 落入 `migrations/`。

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_username_lower
  ON sys_user (lower(username));

CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_teacher
  ON sys_user (teacher_id)
  WHERE teacher_id IS NOT NULL;
```

- 写入前先按 `lower(username)` 查重，命中即 `409 DUPLICATE`；唯一索引兜底并发。
- 同一教师重复开通先按 `teacher_id` 查既有账号；命中即返回幂等结果，不依赖捕获唯一冲突。
- `teacher_id` 为空的 Admin 不受教师唯一索引约束。

## 3. 权限模型

### 3.1 角色能力

| 能力 | ADMIN | TEACHER | 服务端守卫 |
|------|:-----:|:-------:|-----------|
| 用户列表/详情 | ✅ | ⛔ | `requireAdmin` |
| 新建/编辑/分配角色 | ✅ | ⛔ | `requireAdmin` |
| 停用/启用/重置密码 | ✅ | ⛔ | `requireAdmin` |
| 教师账号开通/批量开通 | ✅ | ⛔ | `requireAdmin` |
| 本人课表/本人关联班级/本人空闲 | ✅ | ✅ | `requireAuth` + 数据范围 |
| 其他管理 API | ✅ | ⛔ | `requireAdmin` |

### 3.2 每请求判定

1. `sessionMiddleware` 校验 Cookie 与 `sys_session`；会话被撤销或过期返回 `401`。
2. `loadCurrentUser` 每次请求从 `sys_user` 读取 `role/status/must_change_password/teacher_id`，不信任会话中的角色快照。
3. `status=DISABLED` 立即 `401`；`mustChangePassword=true` 且访问非改密接口返回 `403 STATE_CONFLICT`（P0-02 契约）。
4. `requireAdmin` 在角色不是 `ADMIN` 时返回 `403 FORBIDDEN`，文案「您没有权限执行此操作」。
5. 前端隐藏菜单只是体验，不作为安全边界；Teacher 直接输入 `/users` 或调用 `/api/v1/users` 仍被拒绝。

## 4. 用户 DTO 与列表

列表与详情返回：

```json
{
  "userId": "uuid",
  "username": "T1003",
  "displayName": "王老师",
  "role": "TEACHER",
  "status": "ENABLED",
  "teacherId": "uuid",
  "teacherName": "王老师",
  "version": 3,
  "mustChangePassword": true,
  "lastLoginAt": null
}
```

- `teacherName` 通过 D03 `TeacherQueryService` 批量读取；不跨域 JOIN，不返回教师手机号等无关字段。
- 列表列：账号、姓名、角色、状态、关联教师、最近登录、操作。
- 筛选：`role`、`status`、`keyword`（匹配 `username/display_name`，大小写不敏感）；分页默认 20、最大 100。
- 新增/编辑/停用后返回最新实体并刷新列表；列表不缓存账号状态。
- 不返回 `password_hash`，不返回任何密码字段。

## 5. API 设计

所有端点 `x-phase: P3`、`x-required-roles: [ADMIN]`；写请求要求会话 + CSRF。路径前缀 `/api/v1`。

| 方法 | 路径 | operationId | 说明 | 关键失败 |
|------|------|-------------|------|----------|
| GET | `/users` | `listUsers` | 分页列表 | 401/403 |
| GET | `/users/{userId}` | `getUser` | 详情 | 404 |
| POST | `/users` | `createUser` | 新建用户，返回一次性初始密码 | 400/409 |
| PATCH | `/users/{userId}` | `updateUser` | 编辑姓名（`version`） | 409 |
| PATCH | `/users/{userId}/role` | `updateUserRole` | 分配角色（`version`） | 409 |
| POST | `/users/{userId}/disable` | `disableUser` | 停用并撤销会话（`version`） | 409 |
| POST | `/users/{userId}/enable` | `enableUser` | 启用（`version`） | 409 |
| POST | `/users/{userId}/reset-password` | `resetUserPassword` | 重置随机密码并撤销会话 | 409 |
| POST | `/teachers/{teacherId}/provision-account` | `provisionTeacherAccount` | 一键开通 Teacher 账号 | 404/409 |
| POST | `/teachers/provision-accounts/batch` | `batchProvisionTeacherAccounts` | 批量开通并返回一次性 CSV | 400/409 |

### 5.1 新建用户

请求：

```json
{
  "username": "T1003",
  "displayName": "王老师",
  "role": "TEACHER",
  "teacherId": "uuid"
}
```

响应 `201`：

```json
{
  "data": {
    "user": { "userId": "uuid", "username": "T1003", "displayName": "王老师", "role": "TEACHER", "status": "ENABLED", "teacherId": "uuid", "teacherName": "王老师", "version": 1, "mustChangePassword": true, "lastLoginAt": null },
    "temporaryPassword": "随机16位",
    "alreadyExists": false
  }
}
```

规则：

- `username` 去首尾空格后按 `lower(username)` 查重；命中返回 `409 DUPLICATE`，提示「该登录名已存在」。
- `TEACHER` 必须提供 `teacherId`；教师必须存在、`status=ACTIVE`、`deleted_at IS NULL`，且 `username=employeeNo`；已有账号返回 `409 DUPLICATE`（或改用开通接口获得幂等结果）。
- `ADMIN` 的 `teacherId` 必须为空；传入非空返回 `400 VALIDATION_ERROR`。
- 服务端生成随机初始密码（≥12，实施建议 16 位，含大小写/数字/符号至少 3 类）；不采用客户端 `password` 字段；`must_change_password=true`。
- 同一事务写 `sys_user`、安全审计、`bc.identity.user.created` outbox；密码明文不进入日志/审计。

### 5.2 编辑姓名与角色

- `PATCH /users/{userId}` 只允许 `displayName` + `version`；用户名、角色、教师关联不可在此接口修改。
- `PATCH /users/{userId}/role` 请求：

```json
{ "role": "TEACHER", "teacherId": "uuid", "version": 3 }
```

- `TEACHER` 必须带 `teacherId`；`ADMIN` 必须传 `teacherId: null`；否则 `400 VALIDATION_ERROR`。
- 目标角色与当前相同也按幂等成功处理，但仍校验版本；写审计 `ROLE_CHANGED` 与事件 `bc.identity.user.role-changed`。
- 将启用 Admin 降级时，若其为最后一名启用 Admin，返回 `409 STATE_CONFLICT`，`details.reason=LAST_ADMIN`，零写入。
- 角色变更下一请求生效；不强制重新登录，不重建会话。

### 5.3 停用与启用

请求均为 `{ "version": 3 }`。

**停用**

- 前置：账号存在；`version` 匹配；不是自己；不是最后一名启用 Admin。
- 同一事务：`status=DISABLED`、`version+1`、撤销该用户全部 `sys_session`、写安全审计、追加 `bc.identity.user.disabled`。
- 旧会话下一次请求返回 `401`；已打开页面在下一次 API 调用时被登出。
- 重复停用已停用账号：返回 `409 STATE_CONFLICT`，提示「该账号已停用」。

**启用**

- 前置：账号存在；`version` 匹配；`status=DISABLED`。
- 同一事务：`status=ENABLED`、`version+1`、写安全审计；不修改密码、不清除 `must_change_password`、不自动恢复旧会话。
- 重复启用已启用账号：返回 `409 STATE_CONFLICT`，提示「该账号已启用」。

### 5.4 重置密码

- 请求：`{}`（空对象）；需要 CSRF。
- 生成新的随机密码（≥12，建议 16 位）；Argon2id 哈希；`must_change_password=true`；`password_changed_at=now()`；撤销该用户全部会话。
- 响应 `200`：

```json
{
  "data": {
    "userId": "uuid",
    "temporaryPassword": "随机16位",
    "mustChangePassword": true
  }
}
```

- 初始密码只在本次响应返回；后续详情/列表不再返回；如管理员丢失凭据，只能再次重置。
- 旧密码立即失效；新密码首次登录进入强制改密流程。
- 安全审计 `PASSWORD_RESET`；日志与审计不记录密码明文。

### 5.5 教师一键开通

请求：无 body；路径 `teacherId`。

流程：

1. 调用 D03 `TeacherQueryService.findActiveById(teacherId)`；不存在返回 `404 NOT_FOUND`；`LEFT` 返回 `409 STATE_CONFLICT`「教师已退校，不能开通账号」。
2. 在同一事务内按 `teacher_id` 查既有账号：
   - 存在且 `role=TEACHER`：返回 `200`，`alreadyExists=true`，`temporaryPassword=null`；不新增、不改密。
   - 存在但 `role` 或 `teacher_id` 不匹配：返回 `409 DUPLICATE`，提示登录名或教师关联冲突。
3. 不存在：按 `username=employeeNo`、`displayName=teacher.name`、`role=TEACHER`、`teacherId` 创建；生成一次性密码；`must_change_password=true`。
4. 同一事务写安全审计与 `bc.identity.user.created`、`bc.resource.teacher.account-provisioned` outbox。
5. 响应：

```json
{
  "data": {
    "user": { "userId": "uuid", "username": "T1003", "displayName": "王老师", "role": "TEACHER", "status": "ENABLED", "teacherId": "uuid", "teacherName": "王老师", "version": 1, "mustChangePassword": true, "lastLoginAt": null },
    "temporaryPassword": "随机16位",
    "alreadyExists": false
  }
}
```

- 重复开通是幂等成功，不是错误；前端提示「该教师已有登录账号，未重复创建」。
- 未开通账号的教师首次开通时，`username` 必须复用教师工号；页面不提供手填登录名。

### 5.6 批量开通与凭据 CSV

请求：

```json
{ "teacherIds": ["uuid", "uuid"] }
```

- 1–500 个教师 ID；重复 ID 去重后再处理。
- 全量校验：任一教师不存在、已退校、工号被其他账号占用或存在角色冲突时，整批返回 `409/400` 并零写入。
- 已存在账号的教师不算失败：该行返回 `ALREADY_EXISTS`，不生成新密码。
- 校验通过后，同一事务为缺失账号创建账号；写一条批次安全审计（记录总数/新建数/已存在数，不记录密码）。
- 响应 `200 text/csv; charset=utf-8`，带 UTF-8 BOM，列固定：

```text
工号,姓名,登录名,初始密码,状态
T1001,张老师,T1001,随机16位,CREATED
T1002,李老师,T1002,,ALREADY_EXISTS
```

- 响应头：`Content-Disposition: attachment; filename="teacher-accounts-YYYYMMDDHHmm.csv"`、`Cache-Control: no-store`。
- CSV 只返回一次，不落库、不入日志；页面关闭后不重新展示。

### 5.7 错误契约

| 场景 | HTTP / code | details / 文案 |
|------|-------------|----------------|
| 登录失效/会话撤销 | `401 UNAUTHENTICATED` | 「登录已失效，请重新登录」 |
| Teacher 访问管理 API | `403 FORBIDDEN` | 「您没有权限执行此操作」 |
| 用户/教师不存在 | `404 NOT_FOUND` | 「未找到该数据，可能已被删除」 |
| 用户名/教师账号重复 | `409 DUPLICATE` | 「该登录名已存在」/「该教师已有登录账号」 |
| 已停用再次停用、已启用再次启用 | `409 STATE_CONFLICT` | 「当前状态不允许此操作」 |
| 最后一名启用 Admin | `409 STATE_CONFLICT` | `reason=LAST_ADMIN`；「系统至少保留一个启用中的管理员」 |
| 停用自己 | `409 STATE_CONFLICT` | `reason=SELF_DISABLE`；「不能停用当前登录账号」 |
| 版本过期 | `409 VERSION_CONFLICT` | 「数据已被他人修改，请刷新页面后重试」 |
| 角色/教师关联非法 | `400 VALIDATION_ERROR` | 字段级中文提示 |

## 6. 教师退校事件联动（M-22）

- 订阅事件：`bc.resource.teacher.deactivated`（生产者 D03；payload 含 `teacherId`、`status=LEFT`、通用事件字段）。
- 处理步骤：按 `teacher_id` 查账号；不存在则幂等无操作；存在则置 `DISABLED`、撤销全部会话、写安全审计（action=`TEACHER_LEFT_DISABLE`）并追加 `bc.identity.user.disabled`。
- 事件处理必须幂等；重复投递不产生重复审计/事件（以账号当前状态判断）。
- 复职不自动启用：D03 `LEFT -> ACTIVE` 不调用 identity enable，D08 也不监听恢复事件；管理员必须显式启用。
- 退校停用与手工停用走同一保护判断：若目标账号是最后一名启用 Admin（异常数据），事件处理记录失败审计并告警，不擅自停用；正常教师账号不涉及该分支。
- D03 退校事务内应直接调用 identity 停用命令；事件用于跨进程通知与最终一致性兜底，不作为唯一手段（见 D03 设计 §7）。

## 7. 前端设计

### 7.1 路由与入口

- 路由 `/users`，页面标题「用户与角色」，仅 `ADMIN`；Teacher 导航不出现「用户与角色」，直接访问由路由守卫重定向 `/403`。
- 菜单分组 `identity`；页面描述「维护本地账号、角色与账号状态」。

### 7.2 列表与操作

- 顶部操作：「新增用户」「开通教师账号」「批量开通」。
- 筛选：角色（全部/管理员/教师）、状态（全部/启用/停用）、关键字（账号或姓名）。
- 表格列：账号、姓名、角色、状态、关联教师、最近登录、操作。
- 行操作：编辑、分配角色、停用/启用、重置密码。
- 新增/编辑/停用成功后刷新列表，不等待手动刷新。

### 7.3 开通抽屉与凭据一次性展示

- 「开通教师账号」抽屉：选择在职教师（工号+姓名只读展示）、显示将生成的登录名（=工号）、说明「初始密码只显示一次」。
- 提交后弹一次性凭据面板：登录名、初始密码、复制按钮、下载 CSV（批量）；面板关闭后不再可查。
- 重复开通返回 `alreadyExists=true` 时用信息提示，不显示错误，不展示新密码。
- 批量开通：多选在职教师 → 二次确认「已开通的教师不会重复创建，凭据 CSV 只下载一次」→ 下载 CSV。

### 7.4 关键文案

| 场景 | 文案 |
|------|------|
| 停用确认 | 「停用后该账号将立即退出所有会话，且无法登录。确定停用「{姓名}」吗？」 |
| 启用确认 | 「启用后该账号可重新登录；不会自动恢复旧会话。」 |
| 重置密码确认 | 「重置后旧密码立即失效，所有已登录会话将退出；新密码只显示一次。」 |
| 最后 Admin | 「系统至少需要保留一个启用中的管理员，无法停用或降级该账号。」 |
| 停用自己 | 「不能停用当前登录的账号，请使用其他管理员操作。」 |
| 重复开通 | 「该教师已有登录账号，本次未重复创建。」 |
| 凭据面板 | 「请立即复制或下载，关闭后将无法再次查看；丢失只能重置密码。」 |
| 批量开通 | 「将为选中的 {N} 名教师开通账号；已开通的教师不会重复创建。」 |

## 8. 权限边界测试清单

### 8.1 服务端越权

| 编号 | 请求 | 期望 |
|------|------|------|
| AU-P-01 | Teacher `GET /api/v1/users` | `403 FORBIDDEN` |
| AU-P-02 | Teacher `GET /api/v1/users/{id}` | `403 FORBIDDEN` |
| AU-P-03 | Teacher `POST /api/v1/users` | `403 FORBIDDEN` |
| AU-P-04 | Teacher `PATCH /api/v1/users/{id}` | `403 FORBIDDEN` |
| AU-P-05 | Teacher `PATCH /api/v1/users/{id}/role` | `403 FORBIDDEN` |
| AU-P-06 | Teacher `POST /api/v1/users/{id}/disable` | `403 FORBIDDEN` |
| AU-P-07 | Teacher `POST /api/v1/users/{id}/enable` | `403 FORBIDDEN` |
| AU-P-08 | Teacher `POST /api/v1/users/{id}/reset-password` | `403 FORBIDDEN` |
| AU-P-09 | Teacher `POST /api/v1/teachers/{id}/provision-account` | `403 FORBIDDEN` |
| AU-P-10 | Teacher `POST /api/v1/teachers/provision-accounts/batch` | `403 FORBIDDEN` |
| AU-P-11 | Teacher `GET /api/v1/semesters` | `403 FORBIDDEN` |
| AU-P-12 | Teacher `GET /api/v1/timetable-plans` | `403 FORBIDDEN` |
| AU-P-13 | Teacher `GET /api/v1/grades`、`/subjects`、`/teachers`、`/venues` | `403 FORBIDDEN` |
| AU-P-14 | Teacher `GET /api/v1/operation-logs`、`/exports`、`/print-templates`、`/import` | `403 FORBIDDEN` |

### 8.2 角色变更与停用

| 编号 | 场景 | 期望 |
|------|------|------|
| AU-R-01 | Admin 将另一 Admin 降级为 Teacher | 200；该用户下一请求访问 `/users` 返回 403，无需重新登录 |
| AU-R-02 | Admin 停用某账号后，该账号旧会话请求 `/auth/me` | `401 UNAUTHENTICATED` |
| AU-R-03 | Admin 停用自己 | `409 STATE_CONFLICT`，`reason=SELF_DISABLE`，状态不变 |
| AU-R-04 | Admin 停用/降级最后一名启用 Admin | `409 STATE_CONFLICT`，`reason=LAST_ADMIN`，状态不变 |
| AU-R-05 | Teacher 直接访问 `/users` 页面 | 前端 `/403`；API 仍返回 403 |
| AU-R-06 | Admin 访问全部已定义功能 | 不被权限拦截（不出现 403） |

### 8.3 账号与开通

| 编号 | 场景 | 期望 |
|------|------|------|
| AU-A-01 | 新建 `username=Admin`，已存在 `admin` | `409 DUPLICATE`，行数不变 |
| AU-A-02 | 同一教师重复开通 | `alreadyExists=true`，`sys_user` 行数不变 |
| AU-A-03 | 新建 `role=TEACHER` 不传 `teacherId` | `400 VALIDATION_ERROR` |
| AU-A-04 | 新建 `role=ADMIN` 传 `teacherId` | `400 VALIDATION_ERROR` |
| AU-A-05 | 初始密码 | 长度 ≥12；响应只出现一次；`mustChangePassword=true`；日志无明文 |
| AU-A-06 | 重置密码后旧密码登录 | `401 UNAUTHENTICATED`；新密码可登录且强制改密 |
| AU-A-07 | 教师退校事件 | 账号 `DISABLED`、会话撤销；复职后仍 `DISABLED` |
| AU-A-08 | 批量开通含已存在教师 | CSV 标记 `ALREADY_EXISTS`；不新增、不返回新密码 |

## 9. 验证设计

### 9.1 唯一索引

```sql
-- 大小写不敏感唯一
INSERT INTO sys_user (username, display_name, password_hash, role, teacher_id)
VALUES ('Admin', '管理员A', 'hash', 'ADMIN', NULL);
-- 以下必须被 uq_sys_user_username_lower 拒绝
INSERT INTO sys_user (username, display_name, password_hash, role, teacher_id)
VALUES ('admin', '管理员B', 'hash', 'ADMIN', NULL);

-- 教师一对一
-- 同一 teacher_id 第二次插入必须被 uq_sys_user_teacher 拒绝
```

API 层对应断言：重复登录名返回 `409 DUPLICATE`，`sys_user` 行数不增加。

### 9.2 列表与角色即时生效

1. 新建用户 → 列表立即出现账号、姓名、角色、状态、关联教师。
2. 编辑姓名 → 列表立即更新；`version` 递增。
3. 分配角色 → 列表立即显示新角色；该用户下一请求按新角色判定。
4. 停用 → 列表立即显示 `DISABLED`；旧会话下一请求 `401`。

### 9.3 开通幂等

1. 对教师 `T1003` 首次开通：新建 1 条 `sys_user`，`alreadyExists=false`，返回一次性密码。
2. 再次开通同一教师：返回既有账号，`alreadyExists=true`，`temporaryPassword=null`，`sys_user` 行数不变。
3. 批量开通 3 名教师（其中 1 名已有账号）：CSV 2 行 `CREATED`、1 行 `ALREADY_EXISTS`，账号总数只增加 2。

### 9.4 重置密码与日志

1. 重置前用旧密码登录成功。
2. 重置后旧密码登录失败；新密码登录成功且 `mustChangePassword=true`。
3. 检查应用日志、安全审计、outbox payload：不出现 `temporaryPassword`、密码明文或 `password_hash`。

### 9.5 最后 Admin 与自身保护

1. 仅 1 名启用 Admin 时，停用/降级该账号 → `409 STATE_CONFLICT`，状态与 `version` 不变。
2. 当前 Admin 停用自己 → `409 STATE_CONFLICT`，状态不变。
3. 存在 2 名启用 Admin 时，停用其中 1 名 → 成功；再停用最后 1 名 → `409`。

### 9.6 静态设计测试

`backend/tests/identity-design.test.ts` 读取设计迁移草案、OpenAPI、events 与本文，验证：

- 两个唯一索引存在且大小写/部分索引语义正确；
- D08 端点 operationId、`alreadyExists`、`temporaryPassword`、`mustChangePassword` 契约存在；
- 最后 Admin/自身保护与 403 边界文案存在；
- 教师退校订阅与「复职不自动启用」存在；
- 批量开通请求体与 CSV 响应头契约存在。

## 10. 交付与后续卡

- P0-02/P0-08：提供 `generateInitialPassword`、`hashPassword`、会话撤销与每请求用户读取；D08 只调用导出。
- D03：提供 `TeacherQueryService.findActiveById`、退校命令与 `bc.resource.teacher.deactivated` 事件；D08 不直接写 `teacher` 表。
- D09：教师导入可复用 `TeacherQueryService` 与 D08 幂等开通端口；批量凭据 CSV 不与导入错误报告混用。
- INT-01：验证 Teacher 全部管理 API 403、角色下一请求生效、停用即撤销会话、最后 Admin/自身保护。
- INT-02：实现时如发现契约缺口，先改契约并登记偏差，不静默偏离。
