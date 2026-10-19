# Phase 3 契约摘要（p3-contracts.md）

> Phase 3 = 治理、身份与数据交换：governance（D07）、identity（D08）、exchange 应用模块（D09、D10），以及集成收口卡 INT-01~INT-03。
> `exchange` 是应用编排模块（不构成新的限界上下文），只通过各域查询服务与共享内核工作。

---

## 1. 产出卡片

| 卡片 | 范围 |
|------|------|
| D07 | 操作日志查询、学期存档、当前学期切换（含草稿守卫）、存档只读 |
| D08 | 用户 CRUD、角色分配、停用/启用、重置密码、教师一键开通账号、服务端权限边界 |
| D09 | 批量导入（学期/年级/班级/科目/教师/任课/场地）、错误报告、导入批次 |
| D10 | 全维度 Excel 导出、打印模板、服务端 PDF 预览/打印 |
| INT-01 | 端到端集成收口（七类确认、跨域引用保护、并发、权限、D15 全链路） |
| INT-02 | 契约冻结归档与发布基线 |
| INT-03 | 运行态刷新与交付状态确认 |

---

## 2. 表结构

### 2.1 governance

设计迁移：`docs/knowledge/designs/0030_governance.sql`；实现轮次按 `0030_governance.sql` 落库。

```sql
CREATE TYPE operation_module AS ENUM (
  'DELETE','PUBLISH','OVERWRITE','SWITCH_SEMESTER','IMPORT','ARCHIVE','ADJUST',
  'GENERATE','SAVE_AS','IGNORE_ONCE','LOCK','UNLOCK'
);

operation_log (
  log_id uuid pk,
  operator_id uuid not null references sys_user,
  operator_name text not null,        -- 操作时姓名快照
  module operation_module not null,
  action text not null,               -- 中文动作，如「发布」
  content text not null,              -- 中文、可直接展示；禁止错误码/英文枚举
  target_type text not null,
  target_id uuid not null,            -- 七类关键操作必须有对象
  request_id text,
  created_at timestamptz not null default now()
);
-- 索引：created_at DESC; (operator_id, created_at DESC); (module, created_at DESC);
--       (operator_id, module, created_at DESC)；均以 log_id DESC 稳定排序。
--       (target_type, target_id, created_at DESC) 供对象反查。
-- 追加写触发器拒绝 UPDATE/DELETE；无更新/删除 API，无清理任务（A-20）。

semester_archive (
  archive_id uuid pk,
  semester_id uuid not null unique,
  plan_id uuid not null,              -- 存档时的唯一正式方案
  archived_by uuid not null,
  archived_at timestamptz not null,
  summary jsonb not null,             -- 冻结摘要，含 snapshotHash
  created_at timestamptz not null default now()
);
-- 独立追加写触发器；无更新/删除 API。
```

`summary` 固定包含 `semesterName/academicYear/term/planName/planVersion/publishedAt/classCount/lessonCount/unscheduledCount/conflictCount/snapshotHash`。

### 2.2 identity

```sql
-- 复用 Phase 0 的 sys_user；无新增表
-- 约束：username 唯一（大小写不敏感）、teacher_id 唯一（非空时一对一）
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_username_lower ON sys_user (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_teacher ON sys_user (teacher_id) WHERE teacher_id IS NOT NULL;
```

设计迁移草案：`docs/knowledge/designs/0031_identity_indexes.sql`；详细字段、API、权限与流程见 `docs/knowledge/designs/D08-identity-user-provisioning.md`。

D09 设计迁移草案：`docs/knowledge/designs/0032_exchange_import.sql`；固定模板、issue 错误码、一次性报告与导入向导见 `docs/knowledge/designs/D09-batch-import.md`。

### 2.3 exchange（应用模块支撑表）

```sql
CREATE TYPE import_module AS ENUM ('SEMESTERS','GRADES','CLASSES','SUBJECTS','TEACHERS','ASSIGNMENTS','VENUES');
CREATE TYPE import_batch_status AS ENUM ('COMPLETED','PARTIAL','FAILED');

import_batch (
  batch_id uuid pk,
  module import_module not null,
  filename text not null,
  size_bytes int not null,
  total int not null,               -- 数据行，不含表头与空行
  success int not null,
  failed int not null,              -- 有 ERROR 的去重数据行，不统计 WARNING
  status import_batch_status not null,
  errors jsonb not null default '[]', -- ImportIssue[]，最多 1000 条
  errors_truncated boolean not null default false,
  error_report_url text null,
  error_report_downloaded_at timestamptz null,
  operator_id uuid not null,
  operator_name text not null,
  created_at
);
-- total = success + failed；COMPLETED=>failed=0；PARTIAL=>success>0 && failed>0；FAILED=>success=0。
-- 索引：created_at DESC、operator_id+created_at DESC、status+created_at DESC、module+created_at DESC。

CREATE TYPE paper_size AS ENUM ('A4','A3');
CREATE TYPE paper_orientation AS ENUM ('PORTRAIT','LANDSCAPE');

print_template (
  template_id uuid pk,
  name text not null unique,
  paper_size paper_size not null default 'A4',
  orientation paper_orientation not null default 'LANDSCAPE',
  margin_mm jsonb not null,           -- { top, right, bottom, left }；四项 0..50mm，扣边距后至少 20mm 可打印区域
  title text,
  logo_data_uri text,                 -- 仅 data:image/png;base64；解码后 ≤2 MiB；禁止 SVG/远程 URL
  header_text text,
  footer_text text,
  is_preset boolean not null default false,
  version int not null default 0,
  created_at, updated_at, deleted_at
);
```

> 导出文件不落库；导出不属七类关键操作，只写安全审计 `sys_audit_log`，不写 `operation_log`。

---

## 3. API

### 3.1 治理（D07）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/operation-logs?operatorId=&from=&to=&module=&page=&pageSize=` | Admin 日志查询，时间倒序 |
| GET | `/operation-logs/:logId` | 日志详情 |
| POST | `/semesters/:id/archive` | 学期存档 |
| GET | `/semesters/:id/archive` | 存档信息 |
| POST | `/semesters/:id/switch` | 切换当前学期（含草稿守卫） |
| GET | `/archive-status?semesterId=` | 存档前置检查 |

**日志查询**

- 仅 Admin；Teacher 返回 `403 FORBIDDEN`。
- `operatorId`、`module` 精确匹配；`from` 为包含边界（`>=`），`to` 为不包含边界（`<`）。
- 排序固定 `created_at DESC, log_id DESC`；分页 `page` 从 1 开始、`pageSize` 默认 20 最大 100。
- 无更新/删除 API，无清理任务；返回白名单字段，前端不提供编辑/删除/归档按钮。
- 七类关键操作为 `DELETE/PUBLISH/OVERWRITE/SWITCH_SEMESTER/IMPORT/ARCHIVE/ADJUST`；D05/D21 的 `GENERATE/SAVE_AS/IGNORE_ONCE/LOCK/UNLOCK` 为显式审计扩展，不改变 F18 七类口径。

**存档前置与请求**

`GET /archive-status` 返回 `semesterId/canArchive/reason/publishedPlanId/publishedPlanName`；只读，不写日志或 outbox。

请求：`{ "confirm": true }`（前端已完成二次确认）；未确认 400 且零写入。

前置：目标学期存在唯一 `PUBLISHED` 方案；否则 `409 STATE_CONFLICT`，消息固定为「请先发布正式课表再存档」，零写入。

事务内：

1. 经 registry 查询服务锁定目标学期；不存在 404，已存档 409。
2. 经 timetable 查询服务锁定同学期 `PUBLISHED` 方案；生成冻结摘要与 `snapshotHash`。
3. 调用 `timetable.PlanLifecycleService.archivePublished(tx, planId, actor)`：正式方案 `→ ARCHIVED` 并追加 `bc.timetable.plan.archived`。
4. 调用 `registry.SemesterLifecycleService.archive(tx, semesterId, actor)`：学期 `→ ARCHIVED`、`is_current=false`，写唯一 `ARCHIVE` 日志并追加 `bc.registry.semester.status-changed`。
5. governance 写一条 `semester_archive`；唯一键防止重复存档。
6. 任一步失败全部回滚；禁止 D07 直接 DML registry/timetable 表。

**存档后只读**

- 已存档学期内的编辑、删除、方案生成/发布/覆盖、冲突忽略、锁定、调课、导入提交等写操作均返回 `409 STATE_CONFLICT`，消息「该学期已存档，只能查看或导出」。
- 课表查看、统计、空闲、日志、存档详情、Excel 导出、打印预览保持可用。
- 已存档方案、课次、`semester_archive.summary` 和日志不得改变；其他未引用学期/模板删除不影响该存档（A-17/TC-CM-003）。

**切换学期**

请求：

```json
{ "draftResolution": "SAVE", "draftPlanId": "uuid", "planVersion": 12 }
```

`draftResolution ∈ SAVE / DISCARD / CANCEL`。服务端“草稿”指 `timetable_plan.status='DRAFT'` 的持久化方案；浏览器未提交表单不是服务端状态，选择 SAVE 时客户端必须先调用 D05 保存命令落库，再以返回版本调用本接口。存在多个 DRAFT 时 `draftPlanId` 必填。

| 场景 | 行为 |
|------|------|
| 目标学期 `ARCHIVED` | `409 STATE_CONFLICT`「已存档学期不能切换为当前学期」 |
| 当前学期无草稿 | 直接切换，忽略草稿字段 |
| 有草稿但未传 `draftResolution` | `409 DRAFT_EXISTS`，消息「当前学期存在未发布草稿，请选择保存、放弃或取消」，`details.drafts` 返回 `planId/name/version/updatedAt` |
| 有草稿且 `SAVE` | 校验所选草稿仍为 DRAFT 且 `planVersion` 匹配；草稿保留；切换 |
| 有草稿且 `DISCARD` | 校验版本后经 D05 `discardDraft` 逻辑删除所选 DRAFT；切换 |
| 有草稿且 `CANCEL` | 返回 200 与当前学期；不切换、不删草稿、不写日志/outbox（零写入） |
| 多个 DRAFT 但 SAVE/DISCARD 未给 `draftPlanId` | 400；不得猜测草稿 |

成功切换在同一事务内：D01 `switchCurrent` 清旧 `is_current`、设目标值并写唯一 `SWITCH_SEMESTER` 日志；追加 `bc.registry.semester.current-changed { previousSemesterId, currentSemesterId }`；DISCARD 的草稿删除同事务。

**日志字段与内容**

- 完整字段：操作人（ID + 姓名快照）、时间、模块、中文动作、中文内容、对象类型、对象 ID；请求 ID 可选。
- `content` 示例：「发布 2026 秋季正式课表（方案 2026秋-v4）」「切换当前学期为「2027 春季」」「存档学期「2026 秋季」（方案 2026秋-v4）」。
- D01 的 `archive/switchCurrent` 是该命令的日志写入点；D07 编排不得写第二条同命令日志。

### 3.2 身份（D08）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users?role=&status=&keyword=&page=` | 用户列表 |
| GET | `/users/:userId` | 详情 |
| POST | `/users` | 新建用户 |
| PATCH | `/users/:userId` | 编辑姓名（`version`） |
| PATCH | `/users/:userId/role` | 分配角色（`version`） |
| POST | `/users/:userId/disable` | 停用（撤销会话） |
| POST | `/users/:userId/enable` | 启用 |
| POST | `/users/:userId/reset-password` | 重置为随机密码（一次性返回） |
| POST | `/teachers/:teacherId/provision-account` | 一键开通 Teacher 账号 |
| POST | `/teachers/provision-accounts/batch` | 批量开通，返回一次性凭据 CSV |

规则：

1. `username` 全局唯一（大小写不敏感）；教师账号 `username = employeeNo`；`teacherId` 一对一。
2. `role=TEACHER` 必须提供 `teacherId`；`role=ADMIN` 必须为空。该约束由数据库检查约束与服务端双重保证。
3. 重复开通幂等：返回既有账号并标记 `alreadyExists=true`，不新增、不改密。
4. 初始密码随机 ≥12 位，仅响应中返回一次；`must_change_password=true`；不写日志明文。新建用户与重置密码分别返回一次性凭据；用户详情/列表永不返回密码字段。
5. 角色仅 `ADMIN` / `TEACHER`；每次请求从数据库读取角色（A-18）；角色变更下一请求生效，无需重新登录。
6. 不允许停用/降级最后一个启用中的 Admin；不允许停用自己；两种情况返回 `409 STATE_CONFLICT`（`LAST_ADMIN` / `SELF_DISABLE`）且零写入。
7. 停用账号立即撤销其全部会话；停用/启用请求携带 `version`；旧会话下一请求 `401`。
8. 所有账号操作写安全审计；教师退校事件 `bc.resource.teacher.deactivated` 联动停用账号（M-22），处理幂等，复职不自动启用。
9. 批量开通请求 `{ "teacherIds": ["uuid"] }`（1–500），返回 UTF-8 BOM CSV：`工号,姓名,登录名,初始密码,状态`；已存在账号标记 `ALREADY_EXISTS` 且不返回新密码；响应头 `Cache-Control: no-store`。

| 端点 | 成功响应要点 | 关键失败 |
|------|--------------|----------|
| `POST /users` | 201，`user + temporaryPassword + alreadyExists=false` | 400/409 |
| `PATCH /users/:id/role` | 200，`user`；下一请求生效 | 409 `LAST_ADMIN`/`VERSION_CONFLICT` |
| `POST /users/:id/disable` | 200，`user`；撤销全部会话 | 409 `SELF_DISABLE`/`LAST_ADMIN` |
| `POST /users/:id/enable` | 200，`user`；不恢复旧会话 | 409 `STATE_CONFLICT` |
| `POST /users/:id/reset-password` | 200，`temporaryPassword + mustChangePassword=true` | 409/404 |
| `POST /teachers/:teacherId/provision-account` | 200，`alreadyExists` 可为 true | 404/409 |
| `POST /teachers/provision-accounts/batch` | 200，`text/csv` 一次性凭据 | 400/409 |

**新建用户请求**

```json
{ "username": "T1003", "displayName": "王老师", "role": "TEACHER", "teacherId": "uuid" }
```

### 3.3 导入（D09）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/import/templates/:module` | 下载固定模板（XLSX） |
| POST | `/import/:module/preview` | 解析并返回前 20 行 + 表头校验结果，不写库 |
| POST | `/import/:module` | 上传并执行（multipart，≤20 MB） |
| GET | `/import/batches/:batchId` | 批次结果 |
| GET | `/import/batches/:batchId/errors` | 错误报告 CSV（UTF-8 BOM，一次性） |

`module ∈ SEMESTERS / GRADES / CLASSES / SUBJECTS / TEACHERS / ASSIGNMENTS / VENUES`。

规则（A-07 / H-04）：

- XLSX 为主，接受 UTF-8 CSV；不接受 GBK。
- 首行表头，按列名匹配，顺序可变；未知列忽略并在报告中提示。
- 数据行 >5000 或文件 >20 MB → 整份拒绝，零写入，返回行数与上限。
- 必填列缺失 → 整份拒绝。
- ≤5000 行：逐行校验，合法行提交，非法行跳过；重复键按非法行处理，不做 upsert。
- 数据库故障 → 整批回滚，批次状态 `FAILED`。
- 结果返回 `total/success/failed/status/errors/errorReportUrl`；错误含行号、列名、原值、中文原因。
- 导入提交属七类关键操作；前端二次确认后调用，multipart 必须携带 `confirm=true`，写 `operation_log`（module=`IMPORT`）。
- 七类固定模板列、自然键、中文枚举值和错误码对照固定为 `docs/knowledge/designs/D09-batch-import.md` §3/§7；下载模板为 XLSX。
- 预览返回 `headers/rows(≤20)/totalRows/previewLimit/headerErrors`，零数据库、批次与日志写入。
- 导入结果返回 `ImportBatch`：`total/success/failed/status/errors/errorsTruncated/errorReportUrl`；issue 含 `rowNo/column/rawValue/code/severity/message`。
- 文件级拒绝（>20 MB、>5000 行、缺必填列、重复表头、空文件、非 UTF-8）返回 400/413，且不创建批次。
- 合法行在单一事务中经各域应用服务写入；数据库/基础设施故障回滚全部合法行，再用独立补偿事务写 `FAILED` 批次。
- 错误报告 CSV 列固定为 `行号,列名,原值,错误码,严重级别,中文原因`，UTF-8 BOM；首次下载后再次请求返回 404。

### 3.4 导出（D10）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/exports/options` | 可用维度、学期、课表维度、列字典版本 |
| GET | `/exports/columns?dimension=` | 返回扁平列定义：`key/label/order/sheetKey/sheetName/valueType/format/nullable` |
| POST | `/exports` | 生成并直接返回文件（`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`） |

请求：

```json
{
  "dimension": "TIMETABLE",
  "semesterId": "uuid",
  "timetableDimension": "CLASS",
  "objectIds": ["uuid"],
  "parity": "ALL",
  "scope": "SEMESTER",
  "weekIndex": null
}
```

维度与 Sheet：

| dimension | Sheet 顺序 |
|-----------|------------|
| `MASTER_DATA` | 学期、年级、班级、科目、教师、任课、场地、合班 |
| `TIMETABLE` | 班级、教师、全校、场地、任课；每行固定 12 列 |
| `STATISTICS` | 工作量统计；列与 D11 `WorkloadRow` 一致 |

规则（H-04）：

- `COLUMN_DICTIONARY` 是列名、列序、Sheet 顺序、取值类型、格式化规则的唯一来源；`/exports/columns` 返回同一常量，页面与导出禁止各维护一套。
- 精确列字典、Sheet 结构、12 列课表行契约和统计 8 列见 `docs/knowledge/designs/D10-export-print.md` §3。
- XLSX；只导出值；不写公式/宏/外链/批注/远程图片；日期 `YYYY-MM-DD`，时间 `HH:mm`；空值为空单元格；所有 Sheet 冻结首行表头。
- 文件名 `{维度}_{学期}_{YYYYMMDDHHmm}.xlsx`，维度为中文显示值，学期名净化路径分隔符。
- 1000 行 × 12 列，服务端生成并落盘 p95 ≤3 秒（H-03）；计时覆盖查询、格式化、序列化与落盘。
- 临时文件仅存 `EXPORT_TMP_DIR`，成功响应后删除；清理任务每分钟删除超过 10 分钟的残留文件。
- `MASTER_DATA` 保留 8 个按实体 Sheet；`TIMETABLE` 只导出非空课次行；`STATISTICS` 直接复用 D11 查询，不在 exchange 重算。
- 已存档学期允许导出；跨学期 ID 返回 404，不得回退当前学期。
- 导出操作写安全审计 `sys_audit_log`（`action=EXPORT`）与 `bc.exchange.export.completed`；不属于七类关键操作，不要求二次确认，不写 `operation_log`。

### 3.5 打印（D10）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/print-templates` | 模板列表（预设优先） |
| POST | `/print-templates` | 新建模板 |
| PATCH | `/print-templates/:id` | 编辑（必须携带 `version`） |
| DELETE | `/print-templates/:id` | 逻辑删除（预设模板不可删，409） |
| POST | `/print-templates/:id/logo` | multipart：`logo` PNG ≤2 MiB + `version` |
| POST | `/print/preview` | 返回 PDF（`application/pdf` inline），用于预览 |
| POST | `/print/render` | 返回同一 PDF（download），用于下载/打印 |
| GET | `/print/html/:token` | 内部受保护 HTML；一次性 token，仅供 Playwright 读取 |

请求：

```json
{
  "templateId": "uuid",
  "dimension": "CLASS",
  "objectId": "uuid",
  "semesterId": "uuid",
  "parity": "ALL"
}
```

模板字段：

| 字段 | 规则 |
|------|------|
| `name` | 去空白非空、≤100；未删除记录内大小写不敏感唯一 |
| `paperSize` | `A4` / `A3` |
| `orientation` | `PORTRAIT` / `LANDSCAPE` |
| `marginMm` | `{top,right,bottom,left}` 毫米整数 0..50；扣除后至少 20mm 可打印区域 |
| `title` / `headerText` / `footerText` | 可为空；标题 ≤200，页眉页脚各 ≤500 |
| `logoDataUri` | 仅 PNG data URI；解码后 ≤2 MiB；SVG/伪装文件 400，超限 413 |
| `isPreset` / `version` | 预设不可删除；创建 version=0，编辑/换校徽 +1，冲突 409 |

预设模板固定为：`标准课表 · 校徽版`、`紧凑版（A4 横）`、`教师手册版`；预设逻辑删除和物理删除均由应用与数据库触发器双层拒绝。

规则：

- 打印维度 V1.0 只允许 `CLASS` / `TEACHER`；其他维度 400。
- 预览与打印调用同一 HTML 模板与同一 `renderPdf`，按 `renderKey=sha256(templateId+version+snapshotHash+parity)` 复用同一份 PDF bytes；预览与 render 仅 Content-Disposition 不同。
- HTML 只使用内联 CSS、系统字体和 data URI 校徽，不加载远程资源；受保护地址返回 `no-store`、`no-referrer`、CSP，禁止脚本。
- 打印页 token 为 256-bit 随机值，只存 SHA-256，路径传递；有效期 60 秒、首次成功即消费；过期/重放统一 `401 UNAUTHENTICATED`。
- 服务端 Chromium 复用 browser，每次 new context/page；等待字体与两帧后调用 `page.pdf`，超时 `PRINT_TIMEOUT_MS=30000`。
- PDF/HTML token 仅驻留进程或 10 分钟临时目录，不长期落库；缓存上限 32 份/64 MiB，并发相同 renderKey 用单一 in-flight Promise。
- PDF 指标记录 `browserLaunchMs/htmlLoadMs/pdfRenderMs/totalDurationMs/pdfBytes/pageCount/cacheHit`；实现轮次以 20 次预热后 p50/p95 回填，设计态不声称实测。
- 预览和打印均写 `sys_audit_log`（`action=PRINT_PREVIEW|PRINT_RENDER`）与 `bc.exchange.print.rendered`；不记录 token 原文。

完整模板/PDF/token/前端契约见 `docs/knowledge/designs/D10-export-print.md` §5-§8。

---

## 4. 领域事件

| 事件 | 生产者 | 消费者 |
|------|--------|--------|
| `bc.registry.semester.status-changed` | D07（调用 registry 生命周期服务） | timetable、governance |
| `bc.registry.semester.current-changed` | D01/D07（调用 registry 生命周期服务） | timetable、governance |
| `bc.timetable.plan.archived` | D07 | governance、registry |
| `bc.governance.operation.logged` | D07 | — |
| `bc.identity.user.created` | D08 | — |
| `bc.identity.user.disabled` | D08 | — |
| `bc.identity.user.role-changed` | D08 | — |
| `bc.resource.teacher.account-provisioned` | D08 | resource |

> identity 事件 payload：`user.created { userId, username, role }`、`user.disabled { userId, username, reason }`、`user.role-changed { userId, fromRole, toRole }`；均带通用 `eventId/occurredAt/occurredBy`、`schemaVersion=1` 并写 outbox。D08 订阅 `bc.resource.teacher.deactivated`，以 `teacherId` 幂等停用关联账号并追加 `bc.identity.user.disabled`；复职不产生 enable 命令。
| `bc.exchange.import.completed` | D09 | governance |
| `bc.exchange.export.completed` | D10 | governance |
| `bc.exchange.print.rendered` | D10 | governance |

---

## 5. 前端路由

| 路由 | 页面 | 卡片 | 角色 |
|------|------|------|------|
| `/logs` | 操作日志 | D07 | Admin |
| `/archive` | 多学期存档与切换 | D07 | Admin |
| `/import` | 批量导入 | D09 | Admin |
| `/export` | Excel 导出 | D10 | Admin |
| `/print` | 模板打印 | D10 | Admin |
| `/users` | 用户与角色 | D08 | Admin |

---

## 6. 跨域事务边界

| 用例 | 事务边界 |
|------|----------|
| 学期存档 | 一个事务：semester 状态 + plan 状态 + archive 记录 + operation_log + outbox |
| 切换学期 | 一个事务：草稿保存（可选）+ is_current 切换 + operation_log + outbox |
| 导入单行 | 每行独立保存；整批记录在批次事务中更新；基础设施失败整批回滚 |
| 教师开通账号 | 一个事务：sys_user 插入 + teacher 关联 + 安全审计 + outbox |
| 删除保护 | 先查询引用（各域 query-service），再在同一事务内逻辑删除 |

> 跨域只调用对方导出的应用服务或查询服务；禁止直接写对方表。

---

## 7. 集成收口（INT-01）

INT-01 不新增业务能力，只做跨卡验收：

1. **七类二次确认**：删除类、发布、覆盖方案、切换学期、批量导入提交、学期存档、调课保存，逐一验证「未确认零变更、确认后生效」。
2. **跨域引用保护**：模板被学期钉扎、教师有任课/班主任/账号、科目有任课、场地被课次占用、年级有班级时删除均被拒绝并提示引用关系。
3. **并发**：同一方案两个并发保存，先提交成功，后提交 409 且零写入；主数据单记录同样。
4. **权限**：Teacher 对全部管理 API 返回 403；五视图/空闲查询的本人范围；角色变更下一请求生效。
5. **D15 全链路**：从主数据 → 生成 → 发布 → 五视图 → 导出，逐格一致。
6. **学期隔离**：切换学期后列表、课表、统计、日志无串扰。
7. **存档只读**：存档后全部写接口 409，查看与导出可用。
8. **日志一致性**：关键操作次数与日志条数一一对应。

---

## 8. 完成判定

- 存档前置、覆盖发布、草稿守卫均有接口测试与前端二次确认。
- 日志无删除路径，跨重启可查询；导出/打印可复现。
- 导入超限零写入；部分成功行级错误可下载。
- 所有错误返回中文 `code + message`，前端展示「发生了什么 + 怎么办」。
- INT-01 清单全项有可执行验证脚本（本轮只设计，不运行）。

---

## 9. 冻结与状态刷新（INT-02 / INT-03）

**INT-02 冻结归档**

- 产出 `contracts/` 六件套最终版并校验 OpenAPI。
- 记录 `docs/trace/runs/v1/spac.md`、`agent_plane.md`、`issues.yaml` 的最终版本号。
- 标签命名：`v1.0-design-freeze`（本轮不创建，仅登记）。
- 归档输入快照哈希（PRD、原型、DDD、测试文档），写入 `docs/memory/2026-10-19.md`。

**INT-03 状态刷新**

- 刷新 `README.md` 的「本轮状态」与文档索引。
- 核对 `issues.yaml` 卡片状态全部为 `design`，无 `in_progress`。
- 核对每张卡的 `test-results/{card-id}.md` 存在且执行状态均为「未执行」。
- 输出最终交付清单与偏差说明（子技能未安装等）。
