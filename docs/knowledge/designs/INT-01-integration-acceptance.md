# INT-01 端到端集成收口设计

> 状态：设计态，未执行。本文定义 INT-01 的跨卡验收清单、脚本契约、固定锚点、固定时钟、断言口径与缺陷回派矩阵；不新增业务能力，不修改期望表，不放宽约束。
>
> 权威输入：`p3-contracts.md` §7、`conventions.md` §9、`roles.md`、D01-D11 卡片验收标准、PRD 附件 A、`seed-anchors.sql`、`contracts/openapi.yaml`。

## 1. 边界与判定规则

1. 本卡只验收 D01-D11 的集成行为。发现偏差时记录缺陷并回派对应领域卡，不在 INT-01 修改业务实现或期望表。
2. 设计态只冻结脚本契约和静态矩阵；执行状态一律为「未执行」。实现轮次才允许回填执行结果。
3. 每个用例必须使用本文件 §3 的固定锚点和固定时钟。不得使用自增 ID、真实学校数据或当前时间。
4. 每个用例在独立数据库中执行；用例前后必须采集数据库快照。取消、冲突、403 和 409 断言不仅比较响应，还比较行数、版本、日志、outbox 与快照哈希。
5. 任何断言失败都记录为缺陷；不得通过修改 oracle、删除断言、调整固定数据集或改变状态码口径使测试通过。
6. 重试只能用于排除环境抖动。每次重试前必须重置数据库；重试后仍失败即记缺陷。不得把偶发失败计为通过。

## 2. 验收脚本套件

脚本统一放在实现轮次的 `backend/tests/int-01/` 与 `e2e/int-01/`：执行轮次入口为 `npm run test:int-01`，设计态静态守卫为 `npm run test:int-01:design`。本设计冻结七个可独立运行的脚本组：

| 脚本 ID | 文件契约 | 覆盖 | 运行层 |
|---------|----------|------|--------|
| `INT01-CONFIRM` | `e2e/int-01/01-confirmations.spec.ts` | 七类取消/确认各两遍 | Playwright + 真实 API/DB |
| `INT01-REF` | `backend/tests/int-01/02-reference-protection.integration.test.ts` | 跨域引用保护矩阵 | Supertest + 真实 PostgreSQL |
| `INT01-CONC` | `backend/tests/int-01/03-concurrency.integration.test.ts` | 方案与主数据并发 | Supertest + 真实 PostgreSQL |
| `INT01-PERM` | `backend/tests/int-01/04-permissions.integration.test.ts` | Teacher/Admin 权限矩阵与角色即时生效 | Supertest + 真实 PostgreSQL |
| `INT01-D15` | `backend/tests/int-01/05-d15-chain.integration.test.ts` | 主数据→生成→发布→五视图→导出 | Supertest + PostgreSQL + XLSX 解析 |
| `INT01-ISO` | `backend/tests/int-01/06-semester-isolation-archive.integration.test.ts` | 学期隔离与存档只读 | Supertest + 真实 PostgreSQL |
| `INT01-LOG` | `backend/tests/int-01/07-log-consistency.integration.test.ts` | 七类操作与日志一一对应 | Supertest + 真实 PostgreSQL |

统一执行要求：

- 使用 `TEST_DATABASE_URL` 指向一次性数据库；迁移后执行 `seed-anchors.sql`，测试结束删除测试 schema。
- API 进程通过 `createApp({ clock: fixedClock(INT01_CLOCK) })` 注入固定时钟；Playwright 启动的真实测试服务必须复用同一注入方式，不得使用系统时钟。
- 每个脚本先断言前置数据哈希，再执行操作，最后断言数据、日志、outbox 和响应。
- 脚本只能通过公开 HTTP 契约驱动业务；数据库只用于快照和只读断言，不得直接写业务表来伪造结果。
- 所有取消分支必须断言零写请求；确认分支断言恰好一次成功写请求。
- 七类脚本各自保留独立报告行；任一脚本未执行不得被其他脚本的通过结果替代。

## 3. 固定锚点与固定时钟

### 3.1 固定时钟

- 时钟值：`2026-09-08T00:00:00.000Z`，即 `Asia/Shanghai` 2026-09-08 08:00:00。
- 固定时钟使 D15 学期处于 `IN_PROGRESS`，且所有日志、存档、outbox 时间可逐字段断言。
- 等待锁、会话滑动、性能计时等不得使用真实睡眠；使用可注入时钟推进。

### 3.2 固定 UUID

| 对象 | UUID |
|------|------|
| 预置 Admin | `00000000-0000-4000-8000-000000000100` |
| D15 作息模板 | `00000000-0000-4000-8000-000000000101` |
| D15 模板版本 v1 | `00000000-0000-4000-8000-000000000102` |
| D15 学期 | `00000000-0000-4000-8000-000000000103` |
| 七年级 | `00000000-0000-4000-8000-000000000104` |
| A 班 / 七年级（1）班 | `00000000-0000-4000-8000-000000000105` |
| B 班 / 七年级（2）班 | `00000000-0000-4000-8000-000000000106` |
| 数学 | `00000000-0000-4000-8000-000000000107` |
| 英语 | `00000000-0000-4000-8000-000000000108` |
| 张老师 | `00000000-0000-4000-8000-000000000109` |
| 李老师 | `00000000-0000-4000-8000-00000000010a` |
| 功能室 301 | `00000000-0000-4000-8000-00000000010b` |
| A 班数学任课 | `00000000-0000-4000-8000-00000000010c` |
| A 班英语任课 | `00000000-0000-4000-8000-00000000010d` |
| B 班数学任课 | `00000000-0000-4000-8000-00000000010e` |
| B 班英语任课 | `00000000-0000-4000-8000-00000000010f` |
| 英语课时规则 | `00000000-0000-4000-8000-000000000110` |

隔离用例另使用固定保留段 `00000000-0000-4000-8000-0000000002xx`：第二学期、第二方案、第二课次、第二日志对象均从该段分配，禁止随机 UUID。测试教师账号使用固定账号名 `T1001`，关联 `00000000-0000-4000-8000-000000000109`。

### 3.3 快照定义

每个用例至少采集以下快照：

```text
业务行：semester, schedule_template, schedule_template_version, grade, class, subject,
        teacher, teaching_assignment, venue, combined_class, walking_group,
        timetable_plan, lesson, lesson_class, conflict_detail, adjustment_history,
        semester_archive
治理行：operation_log, sys_audit_log, sys_outbox_event
聚合摘要：各表 count(*) + 受影响记录 version + 规范化 JSON 哈希
```

取消分支要求业务行、治理行和聚合摘要完全不变。确认分支要求业务变化、恰好一条对应 `operation_log`、必要 outbox 事件和一次安全审计均符合契约。

## 4. `INT01-CONFIRM`：七类二次确认

### 4.1 公共动作

- 打开触发入口后断言对话框包含操作名称、对象、影响范围、可撤销性和取消/确认按钮。
- 点击 `[data-confirm-cancel]`：断言对话框关闭、业务快照不变、`operation_log` 行数不变、无成功写请求。
- 重新打开并点击 `[data-confirm-submit]`：断言请求恰好一次、成功后业务状态与日志符合预期。
- 每一类操作各执行「取消→确认」两遍；第二遍使用重置后的同一固定锚点。
- 取消后若前端产生任何写请求，即使服务端拒绝，也判失败（要求未确认零请求、零变更）。

### 4.2 用例矩阵

| ID | 操作 | 触发/接口 | 取消断言 | 确认断言 | 日志模块 |
|----|------|-----------|----------|----------|----------|
| `CF-01` | 删除类 | `/venues` 删除无引用固定场地 | 场地仍在，版本与日志不变 | `deleted_at` 有值，逻辑删除；引用保护用例另行覆盖被引用对象 | `DELETE` |
| `CF-02` | 首次发布 | 方案详情「发布课表」→ `POST /timetable-plans/:id/publish` | 方案仍 `DRAFT`，无 PUBLISHED | 方案 `PUBLISHED`，版本增加，唯一正式方案成立 | `PUBLISH` |
| `CF-03` | 覆盖方案 | 已有 PUBLISHED 时发布第二方案，`confirmOverwrite=true` | 旧 PUBLISHED 保持，第二方案仍草稿 | 旧方案 `SUPERSEDED`，新方案 `PUBLISHED` | `OVERWRITE` |
| `CF-04` | 切换学期 | 学期选择器切到固定第二学期 | `is_current`、业务与日志不变 | 目标 `is_current=true`，旧值清除 | `SWITCH_SEMESTER` |
| `CF-05` | 批量导入提交 | 预览合法文件后点击「确认导入」→ `POST /import/:module` | `import_batch`、目标主数据、日志均不新增 | 批次 `SUCCESS`，合法行写入，响应计数一致 | `IMPORT` |
| `CF-06` | 学期存档 | `/archive`「确认存档学期」→ `POST /semesters/:id/archive` | 学期/方案状态、archive、日志、outbox 不变 | 学期与 PUBLISHED 方案均 `ARCHIVED`，archive 一条、日志一条、outbox 两条 | `ARCHIVE` |
| `CF-07` | 调课保存 | `/timetables/adjust` 拖拽后「确认调课」→ `POST /timetable-plans/:id/adjustments` | lesson 位置/版本、history、日志、outbox 不变 | 整批生效、版本 +1、history 一条、日志一条、事件一条 | `ADJUST` |

覆盖用例：TC-CM-001、CM-002、CM-004、CM-005、AP-006、AP-007、AT-008、BD-013/025、LG-001。`TC-CM-006` 只作为并发设计参考，不计本脚本覆盖。

## 5. `INT01-REF`：跨域引用保护矩阵

| ID | 被删对象 | 固定关系 | 请求 | 期望 |
|----|----------|----------|------|------|
| `REF-01` | 作息模板 `0101` | 学期 `0103` 钉扎版本 `0102` | `DELETE /schedule-templates/0101` | `409 REFERENCE_PROTECTED`，relation 提示包含学期名；模板/版本/学期逐字段不变 |
| `REF-02` | 张老师 `0109` | 任课 `010c`、`010f` | `DELETE /teachers/0109` | `409 REFERENCE_PROTECTED`，提示任课/班级关系；教师仍在 |
| `REF-03` | 李老师 `010a` | A 班班主任固定关系 | `DELETE /teachers/010a` | `409 REFERENCE_PROTECTED`，提示班主任关系；教师仍在 |
| `REF-04` | 教师 `0109` | 已开通 Teacher 账号 `T1001` | `DELETE /teachers/0109` | INT-01 要求 `409` 并提示账号关系；当前 D03/roles 契约存在冲突，见 `DEF-INT-02` |
| `REF-05` | 数学 `0107` | 任课 `010c`、`010e` | `DELETE /subjects/0107` | `409 REFERENCE_PROTECTED`，提示任课关系；当前 OpenAPI 缺删除端点，见 `DEF-INT-01` |
| `REF-06` | 301 `010b` | A/B 班英语课次占用 | `DELETE /venues/010b` | `409 REFERENCE_PROTECTED`，提示课次/合班关系；场地仍在 |
| `REF-07` | 七年级 `0104` | A/B 班引用 | `DELETE /grades/0104` | `409 REFERENCE_PROTECTED`，提示班级关系；年级仍在 |

每一项取消/失败后都必须断言数据库快照完全不变，响应 `message` 为中文，`details` 至少包含关系类型与被引用对象标识。不得只断言 HTTP 409。

覆盖用例：TC-CM-002、BD-006、BD-016、BD-021、RG-009、RG-015、BD-031。

## 6. `INT01-CONC`：并发冲突矩阵

### 6.1 方案并发

1. 读取同一方案 `version=n`，两个请求同时提交不同的重命名或保存内容，均携带 `version=n`。
2. 使用同一启动屏障释放两个请求；收集响应并记录提交先者。
3. 断言响应集合恰为 `{200, 409 VERSION_CONFLICT}`；若运行环境不能稳定判定先者，则按成功响应识别实际先者，失败者必须是同一 `version` 的冲突请求。
4. 最终方案字段等于先者请求；`version=n+1`；失败者内容零写入。
5. `operation_log` 对方案重命名不属七类操作时不新增；若使用七类操作（如发布）驱动，则只允许先者产生一条对应日志。
6. 失败请求不得新增 outbox 或安全审计中的成功事件。

### 6.2 主数据并发

| ID | 对象 | 请求 | 期望 |
|----|------|------|------|
| `CONC-01` | 方案 | 两个 `PATCH /timetable-plans/:planId` 同时携带同版本 | 一 200、一 409；最终等于先者；后提交零写入 |
| `CONC-02` | 场地 | 两个 `PATCH /venues/:id` 同时携带同版本 | 一 200、一 409；最终等于先者 |
| `CONC-03` | 年级或科目 | 两个主数据编辑同时携带同版本 | 一 200、一 409；最终等于先者 |
| `CONC-04` | 失败日志 | 对 `CONC-01` 的失败请求查询日志/outbox | 零新增；`details.requestId` 可追踪但不写业务日志 |

覆盖用例：TC-CM-006（孤儿，按 H-01 口径验证但**不计覆盖**）、P0-03 版本守卫、D05/D06 方案保存。

## 7. `INT01-PERM`：权限矩阵

### 7.1 Teacher 管理 API 全量拒绝

Teacher 使用固定账号 `T1001` 登录并取得 CSRF Token，然后逐一调用下列管理 API。所有请求必须为 `403 FORBIDDEN`，且响应不泄露资源是否存在：

| 能力组 | 方法 + 路径 |
|--------|--------------|
| 学期 | `GET/POST /semesters`；`GET /semesters/current`；`PATCH/DELETE /semesters/{id}`；校历 `GET/POST/DELETE` |
| 作息模板 | `GET/POST /schedule-templates`；版本 `GET/POST`；版本详情/校验；`DELETE /schedule-templates/{id}` |
| 年级班级 | `GET/POST/PATCH/DELETE /grades`；`GET/POST/PATCH/DELETE /classes` |
| 科目 | `GET/POST/PATCH /subjects`；`PUT /subjects/{id}/period-rule`；`GET /controlled-vocabularies` |
| 教师任课 | 教师 `GET/POST/PATCH/DELETE`、退校、恢复、任课列表；任课 `POST/PATCH/DELETE` |
| 场地合班 | 场地 `GET/POST/PATCH/DELETE`；合班/走班 `GET/POST/PATCH/DELETE` |
| 排课方案 | `GET/POST /timetable-plans`；详情 `GET/PATCH/DELETE`；生成、另存、发布、冲突、未排、忽略、去配置 |
| 调课锁定 | 校验、保存、撤销、重做、锁定、解锁、预排新增/删除 |
| 统计 | `GET /statistics/workload` |
| 治理 | 操作日志 `GET`；存档 `GET/POST`；存档状态；切换学期 |
| 用户角色 | 用户 `GET/POST/PATCH`、角色、启停、重置密码；教师开通账号与批量开通 |
| 导入 | 模板、预览、提交、批次、错误 CSV |
| 导出打印 | 导出选项/列/生成；打印模板 CRUD/校徽；预览/渲染/受保护 HTML |

排除项：`/auth/*`、`/health`、`/timetables`、`/my/*`、`/idle-slots` 不属于“管理 API”。其中 `/health` 当前 OpenAPI 角色标注冲突见 `DEF-INT-04`。

### 7.2 Teacher 五视图与空闲本人范围

| ID | 请求 | 期望 |
|----|------|------|
| `PERM-T01` | `GET /timetables?dimension=TEACHER&objectId=0109` | 200；仅张老师课程 |
| `PERM-T02` | `GET /timetables?dimension=TEACHER&objectId=010a` | 403 |
| `PERM-T03` | A 班 `dimension=CLASS` | 200；A 班属于本人任课/班主任关联范围 |
| `PERM-T04` | 非关联其他班 `dimension=CLASS` | 403 |
| `PERM-T05` | `dimension=SCHOOL` | 403 |
| `PERM-T06` | `dimension=VENUE` 任意场地 | 403 |
| `PERM-T07` | `dimension=ASSIGNMENT` 他人任课 | 403 |
| `PERM-T08` | `GET /my/timetable`、`/my/classes`、`/my/classes/{关联班}/timetable`、`/my/idle-slots` | 200，且只返回本人范围 |
| `PERM-T09` | `/idle-slots` 本人教师对象 | 200；与本人课表互补 |
| `PERM-T10` | `/idle-slots` 其他教师、`dimension=CLASS` 或非本人 `objectId` | 403 |

### 7.3 角色变更下一请求生效

1. Admin 将 `T1001` 从 `TEACHER` 改为 `ADMIN`；保持同一会话，不重新登录。
2. 下一请求 `GET /semesters` 必须 200。
3. Admin 将其改回 `TEACHER`；下一请求 `GET /semesters` 必须 403。
4. 角色变更各写一条安全审计；会话 Cookie 不因角色变更失效。

覆盖用例：TC-AU-007、AU-008、AT-002/003/009/010、LG-005。

## 8. `INT01-D15`：30 格全链路

### 8.1 基准表

D15 的 30 格由 6 个表头格 + 24 个数据格组成。数据格顺序固定为 A/B 班 × 周一至周三 × 第 1~4 节；`—` 表示空格。

| 时段 | 周一 A 班 | 周一 B 班 | 周二 A 班 | 周二 B 班 | 周三 A 班 | 周三 B 班 |
|------|----------|----------|----------|----------|----------|----------|
| 第 1 节 | 数学·张（连堂①） | 数学·李 | —（李免排） | — | — | 数学·李 |
| 第 2 节 | 数学·张（连堂②） | — | — | — | — | — |
| 第 3 节 | 英语·李（301） | — | — | 英语·张（301） | —（禁排） | —（禁排） |
| 第 4 节 | — | — | — | — | —（禁排/张免排） | —（禁排） |

唯一机器 oracle：`docs/knowledge/designs/D15-annex-a.fixture.json`。脚本必须直接读取该文件，禁止复制常量或写 D15 特例。

### 8.2 链路断言

| 阶段 | 固定动作 | 断言 |
|------|----------|------|
| 主数据 | 迁移后执行 seed 锚点 | 模板版本、学期、年级、A/B 班、数学/英语、张/李、301、四条任课逐字段等于锚点 |
| 生成 | 对固定学期新建方案，`seed` 固定，连续生成 3 次 | 输出 30 格与 oracle 一致；三类核心冲突 0；三次生成一致 |
| 发布 | 首次发布 | 方案 `PUBLISHED`；唯一正式方案；日志 `PUBLISH` 一条 |
| 五视图 | 分别查询 `CLASS/TEACHER/SCHOOL/VENUE/ASSIGNMENT` | 六条课次 ID 集合与各自范围一致；科目、教师、班级、场地、parity、锁定字段完整 |
| 导出 | `POST /exports` 导出班级课表 | XLSX 可解析；6 个表头 + 24 个数据格逐格同值；日期/时间/空格格式符合约定 |
| 总断言 | 聚合以上四层 | 30 格逐格一致，导出同值，任意一层不一致即失败 |

五视图范围：A 班 `[A-math-1,A-math-2,A-english]`；B 班 `[B-math-1,B-math-2,B-english]`；张老师 `[A-math-1,A-math-2,B-english]`；李老师 `[A-english,B-math-1,B-math-2]`；全校六条；301 `[A-english,B-english]`。课次 ID 由引擎生成时记录并在五视图/导出间复用同一组，不得按视图重建期望。

覆盖用例：TC-AP-017。

## 9. `INT01-ISO`：学期隔离与存档只读

### 9.1 学期隔离

构造两个固定学期 `S1=0103` 与 `S2=0201`，各自拥有不同模板、班级、方案、课次、统计和日志对象。切换 `is_current` 后：

| 面 | 断言 |
|----|------|
| 列表 | 学期、方案、课程列表只返回请求显式学期；无 `semesterId` 的跨学期默认串读必须被拒绝或显式限定当前学期 |
| 课表 | 五视图和 `my` 视图的 lesson ID 集合只含目标学期；另一学期 ID 出现即失败 |
| 统计 | 学期口径/week 口径均只统计目标学期当前 PUBLISHED 方案 |
| 空闲 | 空闲集合由目标学期模板开放槽位减去目标学期占用，其他学期占用不得影响 |
| 日志 | INT-01 要求切换后日志无串扰；当前 D07 契约未定义日志的学期字段/筛选，见 `DEF-INT-03` |

### 9.2 存档只读范围

存档成功后，下列学期内写操作一律 `409 STATE_CONFLICT`，消息「该学期已存档，只能查看或导出」：

- `PATCH/DELETE /semesters/{id}`、再次 `POST /semesters/{id}/archive`；
- 校历新增/删除；
- 学期内方案新建、编辑、删除、生成、另存、发布/覆盖、冲突忽略、去配置；
- 课次预排、调课保存/撤销/重做、锁定/解锁；
- 依赖该学期的导入提交。

不属于学期内写操作的全局主数据新增/编辑仍可用；删除被存档学期引用的数据仍返回 `409 REFERENCE_PROTECTED`。`POST /moves/validate` 为只读校验，不计入写接口拒绝集合，但必须零写入。

以下能力必须保持 200：课表五视图、统计、空闲时段、日志列表/详情、存档详情、Excel 导出、打印预览/渲染。

每个写端点必须在存档前后各采集快照，断言状态、版本、history、outbox、日志均不变；每个 GET/导出断言响应 200 且内容与存档前一致。

覆盖用例：TC-AT-002、LG-003/004/005、BD-005、AP-007。

## 10. `INT01-LOG`：日志一致性

在干净 schema 中依次执行七类操作，每类成功操作重复 `N=3` 次，取消/冲突各插入一次。断言：

| 操作 | 期望日志模块 | 成功次数 | 期望日志条数 |
|------|--------------|----------|----------------|
| 删除 | `DELETE` | 3 | 3 |
| 首次发布 | `PUBLISH` | 3 | 3 |
| 覆盖方案 | `OVERWRITE` | 3 | 3 |
| 切换学期 | `SWITCH_SEMESTER` | 3 | 3 |
| 批量导入提交 | `IMPORT` | 3 | 3 |
| 学期存档 | `ARCHIVE` | 3 | 3 |
| 调课保存 | `ADJUST` | 3 | 3 |
| 取消/冲突 | 无 | 若干 | 0 |

总断言：`operation_log` 恰好新增 21 条；每条包含操作人、固定时间、模块、中文动作、中文内容、对象类型、对象 UUID；日志与对象在同一事务；无更新/删除 API；跨进程/重启查询仍可见。D05 的 `GENERATE/SAVE_AS/IGNORE_ONCE/LOCK/UNLOCK` 属扩展审计，不计入七类 21 条。

覆盖用例：TC-LG-001、TC-CM-001/002、TC-AP-006、TC-AT-008、TC-BD-013。`O-LG-001-PERM` 永久留存仍不可由有限测试证明，不计覆盖。

## 11. 缺陷与回派矩阵

以下为静态对照契约与领域卡验收标准发现的确定缺陷；执行轮次发现的新增缺陷按同一格式追加。

| ID | Plane | 缺陷 | 证据 | 回派卡 | 执行阻断 |
|----|-------|------|------|--------|----------|
| `DEF-INT-01` | [#23](http://localhost:8000/api/v1/workspaces/xunzhi/projects/629a21cb-9504-42b6-83ae-8123cfb68089/issues/14b9f78f-dc6e-4c59-a8aa-920939b8f092/) | 科目删除端点缺失，无法验证“被任课引用的科目删除返回 `REFERENCE_PROTECTED`” | D02 验收标准 vs `contracts/openapi.yaml` 无 `DELETE /subjects/{id}` | D02 | `REF-05` 不可执行 |
| `DEF-INT-02` | [#24](http://localhost:8000/api/v1/workspaces/xunzhi/projects/629a21cb-9504-42b6-83ae-8123cfb68089/issues/4039a596-645f-4bd4-bc24-7bad55394c25/) | 教师账号是否构成删除引用冲突未统一：INT-01 要求有账号拒绝；roles/P1 允许删除无任课/班主任引用教师并停用账号 | `p3-contracts.md` §7 vs `roles.md` §6、`p1-contracts.md` §3.5 | D03（联动 D08） | `REF-04` 期望不确定 |
| `DEF-INT-03` | [#25](http://localhost:8000/api/v1/workspaces/xunzhi/projects/629a21cb-9504-42b6-83ae-8123cfb68089/issues/10f6c428-0a09-47a2-b9a2-fffe4ebfb66e/) | 日志学期隔离缺少数据/接口口径：INT-01 要求日志无串扰；`operation_log` 无 `semester_id`，日志查询无 `semesterId` 筛选 | INT-01 验收标准 vs D07 表结构/API/不变量 10 | D07 | 隔离日志断言不可执行 |
| `DEF-INT-04` | [#26](http://localhost:8000/api/v1/workspaces/xunzhi/projects/629a21cb-9504-42b6-83ae-8123cfb68089/issues/78e285f5-8667-46c0-a5fe-a11456ef5317/) | 健康检查权限标注冲突：P0-01/约定要求公开，OpenAPI 标注 `x-roles: [ADMIN]` | `p0-contracts.md` §3-4、`conventions.md` §3.3 vs `contracts/openapi.yaml` | P0-06（契约冻结） | 权限矩阵豁免口径不确定 |

回派规则：缺陷只进入对应领域卡或独立 Backlog 缺陷卡；INT-01 不直接修改业务实现、不改期望表、不改 D15 基准。每个缺陷必须附复现脚本 ID、请求、期望/实际、影响用例与验收证据。

## 12. 执行结果占位

| 脚本 | 状态 | 通过/失败 | 备注 |
|------|------|-----------|------|
| `INT01-CONFIRM` | 未执行 | — | 设计态 |
| `INT01-REF` | 未执行 | — | `REF-04/05` 受缺陷阻断 |
| `INT01-CONC` | 未执行 | — | 设计态 |
| `INT01-PERM` | 未执行 | — | `DEF-INT-04` 待契约收口 |
| `INT01-D15` | 未执行 | — | 设计态 |
| `INT01-ISO` | 未执行 | — | 日志隔离受 `DEF-INT-03` 阻断 |
| `INT01-LOG` | 未执行 | — | 设计态 |

执行轮次必须在实现卡完成且缺陷回派收口后，逐个替换状态并附命令、日志、截图、导出文件与失败明细。

## 13. 完成与 INT-02 触发

INT-01 进入完成态的最低条件：

1. 七个脚本均有实际执行记录，状态不是「未执行」。
2. 七类确认、引用、并发、权限、D15、隔离、只读、日志全项通过；无未回派失败。
3. D15 30 格与导出逐格一致，oracle 未修改。
4. `test-results/INT-01.md` 回填执行状态与证据链接。
5. 输出集成报告和缺陷关闭记录。

只有满足以上条件，INT-02 才可触发；设计态或部分通过状态不得触发 INT-02。
