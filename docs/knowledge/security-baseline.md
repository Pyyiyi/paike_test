# 认证、会话与安全基线（H-02 实现记录）

> 卡片：P0-02 认证、会话与安全基线
> 本文记录实际安全参数、可复用导出与安全审计用例。
> 不包含任何密钥、Cookie 值、CSRF Token 或密码。

## 1. 安全参数实际值

| 项 | 实际值 | 来源 |
|----|--------|------|
| 密码哈希 | Argon2id（`argon2` 库） | `shared/auth/password.ts` |
| Argon2id 内存 | 65536 KiB（64 MiB） | `ARGON2_MEMORY_KIB` |
| Argon2id 迭代 | 3 | `ARGON2_TIME_COST` |
| Argon2id 并行度 | 1 | `ARGON2_PARALLELISM` |
| 密码最小长度 | 8 | `PASSWORD_MIN_LENGTH` |
| 密码字符类别 | 大写/小写/数字/符号至少 3 类 | `PASSWORD_REQUIRED_CLASSES` |
| 会话 Cookie | `paike.sid`；HttpOnly；SameSite=Lax；生产 Secure；Path=/ | `SESSION_COOKIE_NAME` 等 |
| 空闲超时 | 8 小时（活动时滑动续期） | `SESSION_IDLE_HOURS` |
| 绝对过期 | 7 天 | `SESSION_ABSOLUTE_DAYS` |
| 登录失败阈值 | 同用户名 + IP，15 分钟内 5 次 | `LOGIN_MAX_FAILURES` / `LOGIN_FAILURE_WINDOW_MINUTES` |
| 锁定时长 | 15 分钟 | `LOGIN_LOCK_MINUTES` |
| CSRF | 所有非 GET 请求要求 `X-CSRF-Token`，与会话外 `csrf` Cookie 双提交比对 | `shared/auth/csrf.ts` |
| 会话存储 | PostgreSQL `sys_session`；`revoked_at` 表示服务端失效 | `shared/auth/session-store.ts` |
| 角色/状态读取 | 每次请求从 `sys_user` 读取 | `shared/auth/rbac.ts` |

## 2. P0-03 可复用的鉴权导出

以下为 P0-02 已落地、P0-03 及后续卡片可直接复用的导出。

### 2.1 密码

`@/shared/auth/password`

- `hashPassword(plain, options?)`：Argon2id 哈希。
- `verifyPassword(hash, plain)`：校验失败返回 `false`，不抛异常。
- `validatePasswordPolicy(plain, policy?)`：返回 `{ ok: true }` 或 `{ ok: false, message }`。
- `generateInitialPassword(length?)`：生成满足策略的一次性初始密码。

### 2.2 会话

`@/shared/auth/session`

- `createSessionMiddleware(config, store)`：express-session 中间件。
- `createSession(request, userId, config)`：重新生成会话并写入用户。
- `destroySession(request, config)`：服务端撤销并清 Cookie。
- `touchSession(request, now?)`：更新空闲时间。

### 2.3 CSRF

`@/shared/auth/csrf`

- `issueCsrfToken(response, config)`：签发随机 Token 并写 `csrf` Cookie。
- `createCsrfMiddleware()`：非 GET 请求双提交校验。
- `CSRF_COOKIE_NAME`、`CSRF_HEADER_NAME`。

### 2.4 RBAC

`@/shared/auth/rbac`

- `loadCurrentUser(request, runtime)`：从会话 + `sys_user` 读取当前用户。
- `createLoadCurrentUser(runtime)`：中间件形式。
- `requireAuth`、`requireRole(...roles)`、`requireAdmin`。
- `createForcedPasswordChangeGuard()`：强制改密守卫。
- `CurrentUser`、`UserRole` 类型。

### 2.5 锁定与审计

- `@/shared/auth/lockout`：`LockoutService`（`recordFailure` / `recordSuccess` / `isLocked` / `lockRemainingSeconds` / `clearFailures`）。
- `@/shared/audit/security-audit`：P0-03 的 `writeSecurityAudit(input, { query, clock })`；认证运行时通过 `runtime.writeAudit(input)` 绑定当前连接池与时钟。
- `@/shared/errors/app-error`、`@/shared/errors/codes`：使用 P0-03 的统一 `AppError` / `createAppError`（`httpStatus` 映射）。
- `@/shared/http/async-handler`：使用 P0-03 的异步路由异常转交。

### 2.6 运行时装配

- `@/shared/auth/runtime`：`createAuthRuntime({ config, pool, now? })`，返回 `{ config, pool, now, lockout, writeAudit }`；`await createApp({ auth })` 仅在注入该运行时后由 Hub 挂载认证模块。

## 3. 安全审计用例说明

审计写入 `sys_audit_log`，只记录动作、结果、IP、User-Agent 与必要上下文；不记录密码、Cookie、CSRF Token。

| 场景 | action | result | detail（示例） |
|------|--------|--------|----------------|
| 登录成功 | `LOGIN` | `SUCCESS` | `{ role }` |
| 密码错误 / 账号不存在 | `LOGIN` | `FAILURE` | `{ reason: 'INVALID_CREDENTIALS' }` |
| 账号停用后尝试登录 | `LOGIN` | `FAILURE` | `{ reason: 'ACCOUNT_DISABLED' }` |
| 锁定期内尝试登录 | `LOGIN` | `DENIED` | `{ reason: 'ACCOUNT_LOCKED' }` |
| 退出登录 | `LOGOUT` | `SUCCESS` | — |
| 修改密码 | `CHANGE_PASSWORD` | `SUCCESS` | — |
| 会话空闲/绝对过期 | `SESSION_EXPIRED` | `DENIED` | — |
| 停用账号携带旧会话访问 | `ACCOUNT_DISABLED_ACCESS` | `DENIED` | `{ reason: 'DISABLED' }` |

断言要点：

1. 登录失败文案统一为「用户名或密码错误」，不区分账号不存在与密码错误。
2. 第 6 次失败返回 `423 ACCOUNT_LOCKED`；锁定窗口结束后的正确登录成功，失败计数归零。
3. 退出后旧 Cookie 访问 `/auth/me` 返回 `401`，对应 `sys_session.revoked_at` 非空。
4. 停用账号下一请求返回 `401`，会话被撤销。
5. 无 / 错误 `X-CSRF-Token` 的非 GET 请求返回 `403`；正确 Token 成功。
6. 强制改密用户访问其他接口返回 `403 STATE_CONFLICT`；改密后恢复正常。
7. 密码以 `$argon2id$` 开头存储；策略拒绝短密码与少于 3 类字符的密码。

## 4. 验证结果

- 自动化：`TEST_DATABASE_URL=... npm test` → 16 个测试文件、73 个测试通过（合并 P0-03 后全量）。其中 `auth.integration.test.ts` 9 项，覆盖登录、统一错误、锁定/解锁、退出、CSRF、强制改密、停用账号、空闲过期。
- 静态检查：`npm run lint`、`npm run typecheck`、`npm run build` 通过。
- 运行时：启动 `node dist/main.js` 后，`GET /auth/csrf` → 200；无 CSRF 登录 → 403；正确登录 → 200；`GET /auth/me` → 200；退出 → 200；旧 Cookie 访问 `/auth/me` → 401。服务端日志仅输出启动信息，未出现密码/Cookie/Token。
