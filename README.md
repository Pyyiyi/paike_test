# 智能排课系统 V1.0

面向中小学教务处的本地化排课系统：以「学期 + 作息模板」为排课上下文，完成基础数据维护、一键智能排课、课表可视化调课、冲突校验、工作量统计、导入导出打印、操作留痕与多学期存档。

- 产品需求唯一真相：`input/v1.0/PRD/12-V1.0封版PRD.md`
- 架构设计：`docs/trace/runs/v1/spac.md`
- 开发卡片：`docs/trace/runs/v1/issues.yaml`
- 首轮规划总览：`docs/trace/runs/v1/agent_plane.md`

## 1. 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus | 桌面优先，最小宽度 1280px |
| 后端 | Node.js 20 + Express 4 + TypeScript | 分层：HTTP → 应用服务 → 领域 → 仓储 |
| 数据库 | PostgreSQL 16 | 纯 SQL 迁移，不使用 ORM |
| 认证 | 服务端 Session（`express-session` + PostgreSQL Store） | HttpOnly + SameSite=Lax；Argon2id |
| 表格 | SheetJS（`xlsx`） | XLSX 导入导出 |
| 打印 | Playwright（无头 Chromium） | HTML/CSS → PDF，A4/A3 |
| 校验 | Zod | 请求体、环境变量、导入行 |
| 日志 | Pino | 结构化日志 |
| 测试 | Vitest + Supertest + Playwright | 单元 / 接口 / 端到端 |

## 2. 快速启动

### 2.1 前置条件

- Node.js ≥ 20
- PostgreSQL ≥ 16
- 无头 Chromium（打印功能）：`npx playwright install chromium`

### 2.2 安装与初始化

```bash
npm install
cp .env.example .env
# 按 docs/knowledge/config-contract.md 填写数据库连接与会话密钥
npm run db:migrate
npm run db:seed
npm run dev
```

迁移按 `migrations/NNNN_name.sql` 文件名顺序在事务中执行，并写入 `sys_migration`；重复执行 `npm run db:migrate` 应输出「无待执行迁移」。

`npm run db:seed` 会先执行待应用迁移，再幂等写入管理员、受控词表与当前已存在的 D15 领域锚点；重复执行不会重复插入，也不会重置已修改的管理员密码。固定 UUID 清单见 `docs/knowledge/seed-anchors.md`。

默认访问地址：`http://localhost:5173`（前端开发服务器），后端 `http://localhost:3000`。后端启动后可用 `curl http://localhost:3000/api/v1/health` 检查数据库连通性。

### 2.3 默认管理员

| 项 | 值 |
|----|----|
| 用户名 | `admin` |
| 初始密码 | 由 `PAIKE_ADMIN_INITIAL_PASSWORD` 注入；未注入时首次执行 `npm run db:seed` 在控制台**仅输出一次** |
| 首次登录 | `mustChangePassword=true`，强制修改密码（≥8 位，大写/小写/数字/符号至少 3 类） |
| 重复 seed | 保留现有密码与改密状态，只确保唯一 `admin` 账号为 `ADMIN` / `ENABLED` |

> 初始密码不得写入任何日志文件、不得提交到版本库。D15 与受控词表锚点见 `docs/knowledge/seed-anchors.md`。
>
> 登录页不展示演示账号、默认密码或一键填充入口；首次登录强制跳转 `/change-password`。修改成功后当前会话失效，必须使用新密码重新登录。
> 同一用户名与 IP 在 15 分钟内连续失败 5 次会锁定 15 分钟，登录页显示剩余分钟并禁用提交。

### 2.4 常用命令

```bash
npm run dev            # 同时启动前后端（Vite 代理 /api → 3000）
npm run build          # 前后端生产构建
npm start              # 启动后端（生产）
npm run db:migrate     # 执行数据库迁移
npm run db:seed        # 写入 seed 锚点数据
npm run test           # Vitest 单元 + 接口测试
npm run test:e2e       # Playwright 端到端测试
npm run perf:schedule  # 50 班排课性能基准（H-03）
npm run perf:export    # 1000×12 导出性能基准（H-03）
npm run lint           # ESLint + Prettier 检查
npm run typecheck      # 前后端 TypeScript 类型检查
```

## 3. 目录结构

```
backend/
  src/
    main.ts                  # 进程入口
    app.ts                   # Express 装配
    config/                  # 环境配置读取（config-contract 唯一入口）
    shared/                  # 共享内核（见 shared-kernel-manifest.yaml）
      db/ auth/ http/ errors/ validation/ events/ audit/
      import/ export/ pdf/ time/ upload/
    modules/
      registry/              # bc-registry：学期、模板、年级、班级、科目、校历
      resource/              # bc-resource：教师、任课、场地、合班、走班
      timetable/             # bc-timetable：排课引擎、方案、课次、冲突、调权
      governance/            # bc-governance：操作日志、存档、学期切换
      identity/              # bc-identity：账号、角色、会话
  migrations/                # 顺序 SQL 迁移
  tests/                     # Vitest + Supertest
frontend/
  src/
    router/ stores/ api/ shared/ views/ components/
    views/
      auth/ registry/ resource/ timetable/ governance/ identity/
e2e/                         # Playwright
docs/
  knowledge/
    config-contract.md
    dependency-graph.yaml
    shared-kernel-api.md
    module-template.md
    designs/
    phase-contracts/
  trace/runs/v1/
    spac.md
    agent_plane.md
    issues.yaml
    test-results/            # 每张卡片的测试案例对比验证
conventions.md
schema-shared.sql
seed-anchors.sql
shared-kernel-manifest.yaml
roles.md
scenes.md
```

## 4. 环境变量

完整清单与默认值见 `docs/knowledge/config-contract.md`。最小集合：

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://paike:paike@localhost:5432/paike
SESSION_SECRET=<32 字节以上随机串>
PAIKE_ADMIN_INITIAL_PASSWORD=
SESSION_IDLE_HOURS=8
SESSION_ABSOLUTE_DAYS=7
LOGIN_MAX_FAILURES=5
LOGIN_LOCK_MINUTES=15
UPLOAD_DIR=./var/uploads
EXPORT_TMP_DIR=./var/exports
PRINT_BASE_URL=http://localhost:3000
```

## 5. 页面与功能对照

| 路由 | 页面 | 功能 |
|------|------|------|
| `/login` | 登录 | F20 认证 |
| `/change-password` | 修改密码（强制/主动） | F20 |
| `/` | 系统概览 | 学期状态、快捷入口、最近日志 |
| `/semesters` | 学期管理 | F1 |
| `/schedule-templates` | 作息模板 | F2 |
| `/grades-classes` | 班级·年级 | F3 |
| `/subjects` | 科目与课时规则 | F4 |
| `/teachers` | 教师与任课 | F5 |
| `/venues` | 场地·功能室 | F6 |
| `/combined-classes` | 合班课 | F7 |
| `/walking-groups` | 走班配置 | F10 |
| `/scheduling` | 一键排课 | F8 / F9 |
| `/scheduling/pre` | 预排与锁定 | F9 |
| `/timetables` | 多维度课表 | F11 |
| `/timetables/adjust` | 拖拽调课 | F12 |
| `/idle-slots` | 空闲时段 | F13 |
| `/statistics` | 工作量统计 | F14 |
| `/export` | Excel 导出 | F15 |
| `/print` | 模板打印 | F16 |
| `/conflicts` | 冲突校验中心 | F17 |
| `/logs` | 操作日志 | F19 |
| `/archive` | 多学期存档 | F19 |
| `/users` | 用户与角色 | F20 |
| `/me/timetable` | 我的课表（Teacher） | F11 |
| `/me/idle-slots` | 我的空闲时段（Teacher） | F13 |

## 6. 角色与权限

完整权限矩阵见 `roles.md`。要点：

- Admin：全部配置、排课、调课、统计、导入导出打印、日志存档、用户管理。
- Teacher：仅本人课表、本人关联班级课表、本人空闲时段；所有管理入口与 API 均拒绝。
- 权限在**服务端每个请求**重新判定，前端隐藏只作为体验优化。

## 7. 数据与接口约定

- 所有写接口需要 `X-CSRF-Token`（`GET /api/v1/auth/csrf` 获取）。
- 所有写接口携带乐观版本 `version`；版本不一致返回 `409 VERSION_CONFLICT`。
- 响应统一为 `{ "data": ... }` 或 `{ "error": { "code", "message", "details" } }`。
- 所有面向用户的文案为中文，禁止使用技术黑话（详见 `conventions.md` §8）。

## 8. 文档索引

| 文档 | 内容 |
|------|------|
| `docs/trace/runs/v1/spac.md` | 架构设计 §1-§11 |
| `docs/trace/runs/v1/agent_plane.md` | 卡片规划、差距报告、校验清单、依赖图 |
| `docs/trace/runs/v1/issues.yaml` | 首轮全部开发卡片 |
| `docs/trace/runs/v1/test-results/` | 逐卡片测试案例对比验证（设计态，未执行） |
| `docs/trace/runs/v1/delivery-checklist.md` | INT-03 交付清单、核对结果与偏差说明（子技能、孤儿、应用模块） |
| `docs/knowledge/designs/INT-01-integration-acceptance.md` | 跨卡端到端验收清单、固定锚点、七组脚本契约与缺陷回派矩阵（设计态，未执行） |
| `conventions.md` | 9 类跨卡片共享技术约定 + 枚举速查 |
| `schema-shared.sql` | 8 张共享基础设施表 |
| `seed-anchors.sql` | 跨域共享测试数据锚点 |
| `docs/knowledge/seed-anchors.md` | D15 固定 UUID 与受控词表清单（供 D05 使用） |
| `shared-kernel-manifest.yaml` | 共享内核文件与 import 路径 |
| `roles.md` | 角色权限定义 |
| `scenes.md` | 场景链路分析 |
| `docs/knowledge/config-contract.md` | 环境变量唯一真相 |
| `docs/knowledge/dependency-graph.yaml` | 域依赖拓扑 |
| `docs/knowledge/shared-kernel-api.md` | 共享内核 API |
| `docs/knowledge/module-template.md` | 模块骨架模板 |
| `docs/knowledge/designs/` | 领域卡设计说明（含 D03 教师/任课、D05 排课引擎与 D15、D07 治理日志/存档/切换） |
| `docs/knowledge/phase-contracts/` | 各 Phase 契约摘要 |

## 9. 本轮状态

本轮（INT-03 状态刷新与交付确认）只做状态与文档核对，不修改业务设计、不执行测试。

- 设计与卡片基准：`docs/trace/runs/v1/`；`issues.yaml` 22 张卡保持 `design`，无 `in_progress`/`done` 卡片状态。
- 测试对比：22 份 `test-results/{card-id}.md` 齐全；每份文件的设计态结论统一标记 `执行状态：未执行`，不声称任何测试通过。
- 基线说明：`origin/main` 的部分 `test-results` 另含后续实现/静态验证记录（例如 D01、P0-01、P0-08）；这些记录原样保留，属于后续轮次证据，不是本卡的设计态执行结论。
- 交付核对：核对清单、偏差与下一轮入口见 `docs/trace/runs/v1/delivery-checklist.md`。
- 输入：`input/` 未修改。
