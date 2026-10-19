# 模块骨架模板（module-template.md）

> 所有领域卡（D01-D11）必须按本模板落地。模板确保：路由自动发现、分层清晰、事务边界统一、错误与日志一致。

---

## 1. 后端模块目录

```
backend/src/modules/<context>/
├── index.ts                    # 模块导出（供 Hub 自动扫描）
├── <context>.router.ts         # 路由注册
├── <context>.controller.ts     # HTTP 层
├── <aggregate>/
│   ├── <aggregate>.domain.ts
│   ├── <aggregate>.repository.ts
│   ├── <aggregate>.service.ts
│   ├── <aggregate>.mapper.ts
│   └── <aggregate>.query-service.ts   # 跨域只读接口（仅需要时）
├── dto/
│   ├── create-<aggregate>.schema.ts
│   └── update-<aggregate>.schema.ts
└── events/
    └── <aggregate>.events.ts
```

### 1.1 `index.ts`（可选）

`index.ts` 仅用于本域内部聚合导出，**不是路由注册表**。Hub 直接扫描 `<context>.router.ts`，新增领域不得修改 Hub 或追加任何中心清单。

```ts
export const contextName = 'registry';
```

### 1.2 `<context>.router.ts`

```ts
import { Router } from 'express';
import { asyncHandler } from '@/shared/http/async-handler';
import { requireAdmin } from '@/shared/auth/rbac';
import { validateBody } from '@/shared/validation/common';
import * as controller from './registry.controller';
import { CreateSemesterSchema } from './dto/create-semester.schema';

export const registryRouter = Router();

registryRouter.get('/semesters', requireAdmin, asyncHandler(controller.listSemesters));
registryRouter.post(
  '/semesters',
  requireAdmin,
  validateBody(CreateSemesterSchema),
  asyncHandler(controller.createSemester),
);
```

路由文件必须且只能选择一种导出约定：

- `export const router = Router()`；
- `export default Router()`；
- `export const registryRouter = Router()`（文件名前缀为 `registry`）；
- `export function createRouter(context): Router | null | Promise<Router | null>`，用于依赖运行时注入或需要条件挂载的模块。返回 `null` 表示本进程不挂载该路由。

规则：

- 文件必须位于 `modules/<context>/<context>.router.ts`，文件名必须与目录名一致。
- Hub 将路由挂载到 `/api/v1`；域需要额外前缀时由路由文件自行声明，例如认证模块内部挂载 `/auth`。
- 路由文件只做装配；不得写 SQL、业务判断。
- 所有处理器经 `asyncHandler` 包装。
- 所有写路由经 `requireAdmin`（教师端只读路由除外）与 CSRF 中间件。

### 1.3 `<context>.controller.ts`

```ts
import type { Request, Response } from 'express';
import { ok, created } from '@/shared/http/envelope';
import { loadCurrentUser } from '@/shared/auth/rbac';
import * as service from './semester/semester.service';

export async function listSemesters(req: Request, res: Response) {
  const items = await service.list({ includeArchived: req.query.includeArchived === 'true' });
  ok(res, { items });
}

export async function createSemester(req: Request, res: Response) {
  const user = await loadCurrentUser(req);
  const result = await service.create(req.body, user);
  created(res, result);
}
```

### 1.4 `<aggregate>.domain.ts`

```ts
export interface SemesterProps { /* 领域字段 */ }

export class Semester {
  private constructor(private props: SemesterProps) {}

  static create(input: CreateSemesterInput, clock: Clock): Semester { /* 不变量 */ }
  static restore(props: SemesterProps): Semester { /* 从 DB 恢复 */ }

  assertEditable(): void {
    if (this.props.status === 'ARCHIVED') {
      throw new ConflictError('STATE_CONFLICT', 409, '该学期已存档，只能查看或导出');
    }
  }

  toProps(): SemesterProps { return { ...this.props }; }
}
```

规则：

- 领域对象不依赖 Express、`pg`、HTTP。
- 不变量在构造函数/工厂中强制，不依赖调用方。
- 时间经 `Clock` 注入。

### 1.5 `<aggregate>.repository.ts`

```ts
export interface SemesterRepository {
  findById(id: string, tx?: Tx): Promise<Semester | null>;
  list(filter: SemesterFilter): Promise<Semester[]>;
  insert(tx: Tx, semester: Semester): Promise<void>;
  update(tx: Tx, semester: Semester, expectedVersion: number): Promise<void>; // 0 行 → VersionConflictError
}
```

规则：

- SQL 仅出现在 repository 与 query-service。
- 查询必须过滤 `deleted_at IS NULL`（若表支持软删除）。
- 列表查询必须限定 `semester_id`（若表属于学期）。

### 1.6 `<aggregate>.service.ts`

```ts
export async function create(input: CreateSemesterInput, user: CurrentUser): Promise<SemesterDto> {
  return withTransaction(async (tx) => {
    const semester = Semester.create(input, systemClock);
    await repo.insert(tx, semester);
    await appendEvent(tx, { eventName: 'bc.registry.semester.created', ... });
    await writeOperationLog(tx, { ... });
    return toDto(semester);
  });
}
```

规则：

- 一个用例一个事务。
- 先校验状态与引用，再写入。
- 写业务、事件、日志必须在同一 `tx`。

### 1.7 `<aggregate>.query-service.ts`

```ts
export interface ClassQueryService {
  getClassSummary(classId: string): Promise<{ classId: string; name: string; gradeId: string; studentCount: number } | null>;
  listClassesBySemester(semesterId: string): Promise<ClassSummary[]>;
  isTeacherHeadTeacher(teacherId: string, classId: string): Promise<boolean>;
}
```

规则：

- 只读、无副作用。
- 返回 DTO，不返回领域对象。
- 其他域只能 import 本文件，不得 import repository。

---

## 2. 前端模块目录

```
frontend/src/views/<context>/
├── routes.ts                 # 路由定义（自动扫描）
├── <Feature>ListView.vue
├── <Feature>FormDialog.vue
├── components/
└── composables/
    └── use<Feature>.ts
```

### 2.1 `routes.ts`

```ts
import type { RouteRecordRaw } from 'vue-router';

export const registryRoutes: RouteRecordRaw[] = [
  {
    path: '/semesters',
    name: 'semesters',
    component: () => import('./SemesterListView.vue'),
    meta: { roles: ['ADMIN'], title: '学期管理', nav: 'registry' },
  },
];
```

### 2.2 页面结构

```vue
<template>
  <PageHeader title="学期管理" description="每个学期必须绑定一个作息模板">
    <template #actions>
      <el-button type="primary" @click="openCreate">新增学期</el-button>
    </template>
  </PageHeader>

  <ErrorBanner v-if="error" :message="error" @retry="refresh" />

  <DataTable
    :columns="columns"
    :rows="rows"
    :loading="loading"
    empty-text="还没有学期，点击『新增学期』开始配置"
  >
    <template #actions="{ row }">
      <el-button link @click="openEdit(row)">编辑</el-button>
      <el-button link type="danger" @click="confirmDelete(row)">删除</el-button>
    </template>
  </DataTable>
</template>
```

规则：

- 页面只编排：数据获取 → 表格/表单 → 确认 → 调用 API → 刷新。
- 不在页面内拼 SQL、错误码、英文枚举。
- 所有删除/发布/覆盖/切换/导入/存档/调课保存必须通过 `useConfirm`。
- 所有异步动作通过 `useAsyncAction`，成功/失败统一 Toast。

### 2.3 组合式函数

```ts
export function useSemesters() {
  const query = useQuery(() => 'semesters', () => semesterApi.list());
  const remove = useMutation((row: SemesterSummary) => semesterApi.remove(row.semesterId, row.version));
  return { ...query, remove };
}
```

---

## 3. Hub 文件

### 3.1 后端路由 Hub

实现文件：`backend/src/modules/index.ts`。

- 使用 `fast-glob` 扫描 `modules/*/*.router.ts`，按绝对路径字典序加载，保证挂载顺序稳定。
- 扫描扩展名跟随当前运行文件（源码/`tsx` 为 `.ts`，构建产物为 `.js`）。
- 每个文件动态加载并校验上下文目录、文件名与 Router 导出；不维护逐域 import 清单。
- 挂载统一前缀为 `/api/v1`。`createRouter(context)` 返回 `null` 时跳过；认证模块在未注入 `AuthRuntime` 时即走此分支。
- 启动日志格式：`[hub] 模块路由扫描完成：发现 N 个文件，挂载 M 个，耗时 Xms`。
- 接入步骤：新建 `modules/<context>/<context>.router.ts` → 按上述四种约定之一导出 Router → 重启服务；不得修改 `app.ts` 或 Hub。

扫描预算与实测（单模块骨架，2026-10-19）：`tsx` 冷启动含首次 TypeScript 动态加载，三次启动样本为 `55.46ms`、`147.73ms`、`258.19ms`（受模块缓存与机器负载影响）；同进程热扫描为 `1.58ms`–`4.60ms`；构建产物 `npm start` 为 `19.22ms`。预算为冷启动 `<500ms`、热扫描 `<20ms`；新增领域后以启动日志实测为准。

### 3.2 前端路由 Hub

实现文件：`frontend/src/router/index.ts` 与 `frontend/src/router/route-registry.ts`。

```ts
const modules = import.meta.glob<DomainRouteModule>('../views/*/routes.ts', { eager: true });
export const domainRoutes = collectDomainRoutes(modules);
```

- Vite 在构建期扫描 `views/*/routes.ts`，按文件路径稳定排序后合并导出的 `routes` 数组。
- 每个文件必须导出 `routes: RouteRecordRaw[]`；缺失导出、重复路由名或重复绝对路径会抛出包含文件名与冲突来源的错误。
- 接入步骤：新建 `views/<context>/routes.ts` → 导出 `routes` → 重启/构建；不得修改 `frontend/src/router/index.ts` 的中心清单。

### 3.3 导航 Hub

```ts
// frontend/src/shared/navigation.ts
export const ADMIN_NAV = [
  { key: 'overview', label: '系统概览', to: '/' },
  { key: 'registry', label: '基础数据', children: [...] },
  // ...
];
```

> 新增域只在自身 `routes.ts` 声明 `meta.nav`，导航由约定式扫描汇总。

---

### 3.4 上下文边界门禁

`eslint.config.mjs` 通过 `import/no-restricted-paths` 执行以下规则；域列表由 `backend/src/modules` 目录自动生成，新增上下文会自动纳入：

1. `backend/src/shared/**` 不得 import `backend/src/modules/**`。
2. `frontend/src/shared/**` 不得 import `frontend/src/views/**`。
3. 任一 `backend/src/modules/<context>/**` 不得直接 import 其他上下文的 `*.repository.ts` 或 `*.domain.ts`；跨域协作只允许应用服务、查询服务、DTO 或领域事件。

违规输出同时包含 ESLint 正在检查的文件和实际 import 路径，例如：

```text
backend/src/shared/boundary-violation.ts
  Unexpected path "../modules/auth/auth.router" imported in restricted zone. ...
```

规则样例测试位于 `backend/tests/boundary-lint.test.ts`；自动装配测试位于 `backend/tests/module-router.test.ts` 与 `frontend/src/router/route-registry.test.ts`。PR 前必须通过 `npm run lint` 与 `npm run typecheck`。

## 4. 测试模板

```
backend/tests/<context>/<aggregate>.service.test.ts
backend/tests/<context>/<context>.api.test.ts
e2e/<journey>.spec.ts
```

每个用例：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, seedAnchors } from '../helpers/db';

describe('SemesterService.create', () => {
  beforeEach(async () => { await resetTestDb(); await seedAnchors(); });

  it('未选择作息模板时拒绝创建（TC-BD-003）', async () => {
    await expect(service.create({ ...validInput, scheduleTemplateVersionId: null }, admin))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
```

规则：

- 每个测试文件独立 schema 或事务回滚。
- 固定 UUID 来自 `seed-anchors.sql`。
- 时间使用 `fixedClock`。
- 不依赖执行顺序。

---

## 5. 卡片落地检查清单

每张领域卡完成时逐项确认：

- [ ] 路由文件存在且被 Hub 自动发现
- [ ] 未修改 `app.ts`、`modules/index.ts` 或 `frontend/src/router/index.ts` 的中心注册清单
- [ ] 领域间未直接 import 其他上下文 repository/domain，`npm run lint` 通过
- [ ] 每个用例一个事务
- [ ] 乐观锁 `version` 生效，409 零写入
- [ ] 引用保护与状态守卫有测试
- [ ] 关键操作写 `operation_log`
- [ ] 领域事件写 `sys_outbox_event`
- [ ] 前端所有文案中文、用户友好
- [ ] 二次确认覆盖七类关键操作（涉及时）
- [ ] 教师端越权请求服务端 403
- [ ] 卡片声明的测试案例对比验证已写入 `test-results/<card-id>.md`
