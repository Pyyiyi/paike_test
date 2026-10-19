# 前端骨架、布局与共享组件契约（P0-04）

> 技术栈：Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus。桌面优先，最小宽度 1280px。
> 唯一 HTTP 边界：`frontend/src/shared/api/http.ts`；业务域只通过 `shared/api/<domain>.api.ts` 访问接口。

## 1. 路由清单

### 1.1 公开与账号路由

| 路由 | 页面 | 权限/行为 | 当前状态 |
|------|------|-----------|----------|
| `/login` | 登录 | 公开；已登录用户按角色回到工作台 | 骨架可用，P0-08 继续完善 |
| `/change-password` | 修改密码 | 已登录；强制改密期间唯一允许的业务路由 | 骨架可用，P0-08 继续完善 |
| `/403` | 权限不足 | 已登录；角色不符时进入 | 可用 |
| `/:pathMatch(.*)*` | 页面不存在 | 已登录；未知地址兜底 | 可用 |

### 1.2 Admin 路由

| 路由 | 页面 | 当前状态 |
|------|------|----------|
| `/` | 系统概览 | 占位页 |
| `/semesters` | 学期管理 | 占位页，域名卡片补齐 |
| `/schedule-templates` | 作息模板 | 占位页，域名卡片补齐 |
| `/grades-classes` | 年级与班级 | 占位页，域名卡片补齐 |
| `/subjects` | 科目与课时 | 占位页，域名卡片补齐 |
| `/teachers` | 教师与任课 | 占位页，域名卡片补齐 |
| `/venues` | 场地与功能室 | 占位页，域名卡片补齐 |
| `/combined-classes` | 合班课 | 占位页，域名卡片补齐 |
| `/walking-groups` | 走班配置 | 占位页，域名卡片补齐 |
| `/scheduling` | 一键排课 | 占位页，域名卡片补齐 |
| `/scheduling/pre` | 预排与锁定 | 占位页，域名卡片补齐 |
| `/conflicts` | 冲突校验 | 占位页，域名卡片补齐 |
| `/timetables` | 多维度课表 | 占位页，域名卡片补齐 |
| `/timetables/adjust` | 拖拽调课 | 占位页，域名卡片补齐 |
| `/idle-slots` | 空闲时段 | 占位页，域名卡片补齐 |
| `/statistics` | 工作量统计 | 占位页，域名卡片补齐 |
| `/import` | 批量导入 | 占位页，域名卡片补齐 |
| `/export` | Excel 导出 | 占位页，域名卡片补齐 |
| `/print` | 模板打印 | 占位页，域名卡片补齐 |
| `/logs` | 操作日志 | 占位页，域名卡片补齐 |
| `/archive` | 多学期存档 | 占位页，域名卡片补齐 |
| `/users` | 用户与角色 | 占位页，域名卡片补齐 |

### 1.3 Teacher 路由

| 路由 | 页面 | 权限 |
|------|------|------|
| `/me/timetable` | 我的课表 | `TEACHER` |
| `/me/idle-slots` | 我的空闲时段 | `TEACHER` |

### 1.4 守卫顺序

1. 会话：调用 `/auth/me`，未登录跳 `/login?redirect=<原路径>`。
2. 强制改密：`mustChangePassword=true` 时仅允许 `/change-password`。
3. 角色：检查 `meta.roles`，不符跳 `/403`。
4. 页面：通过后加载域路由组件。

教师默认落地 `/me/timetable`；管理员默认落地 `/`。

## 2. 导航与截图说明

导航定义位于 `frontend/src/shared/navigation.ts`。Teacher 导航只产生「我的课表」「我的空闲时段」「退出登录」三个可操作项，不渲染任何管理入口。

截图由 `npm run test:e2e` 生成，HTTP 边界在浏览器层使用测试桩，不使用演示账号或假页面数据：

| 截图 | 说明 |
|------|------|
| `../trace/runs/v1/screens/P0-04/login-redirect.png` | 未登录访问 `/semesters` 后落地登录页，地址保留 `redirect` 查询参数。 |
| `../trace/runs/v1/screens/P0-04/admin-navigation.png` | Admin 导航显示系统概览、基础数据、排课、课表、统计、数据交换、日志存档与用户入口。侧栏超高时可滚动。 |
| `../trace/runs/v1/screens/P0-04/teacher-navigation.png` | Teacher 导航仅显示我的课表、我的空闲时段、退出登录。 |
| `../trace/runs/v1/screens/P0-04/version-conflict.png` | 409 版本冲突显示中文刷新提示，界面不出现 `VERSION_CONFLICT` 或 HTTP 状态码。 |
| `../trace/runs/v1/screens/P0-04/confirm-dialog-focus.png` | 二次确认展示操作、对象、影响、可撤销性；键盘焦点进入取消/确认按钮并循环。 |

## 3. 共享组件 Props / Events

### 3.1 `AppLayout` / `SideNav` / `SemesterSelector` / `UserMenu`

| 组件 | Props | Events | 说明 |
|------|-------|--------|------|
| `AppLayout` | 无 | 无 | 读取会话与角色，组合侧栏、学期选择器和用户菜单。 |
| `SideNav` | `items: NavItem[]` | `logout` | `NavItem` 支持 `label`、`to`、`children`、`action: 'logout'`。 |
| `SemesterSelector` | 无 | 无 | 使用 `useSemesterStore`，切换前调用 `useConfirm`。 |
| `UserMenu` | 无 | `logout` | 展示显示名与中文角色名，不展示角色枚举。 |

### 3.2 `ConfirmDialog`

| 项目 | 契约 |
|------|------|
| Props | `modelValue: boolean`、`options: ConfirmOptions \| null` |
| Events | `update:modelValue(boolean)`、`confirm()`、`cancel()`、`closed()` |
| `ConfirmOptions` | `title`、`object?`、`description?`、`impact`、`reversible`、`confirmText`、`cancelText?`、`danger?` |
| 无障碍 | 打开后聚焦取消按钮；Tab/Shift+Tab 在对话框内循环；Esc 触发取消。 |

七类关键操作定义在 `CRITICAL_ACTION_SPECS`：删除、发布、覆盖、切换、导入、存档、调课。`createCriticalConfirmOptions(action, object)` 生成统一确认文案；未确认不会执行后续写操作。

### 3.3 `DataTable`

| 项目 | 契约 |
|------|------|
| Props | `columns: TableColumn[]`、`rows: TableRow[]`、`loading?`、`emptyText?`、`emptyDescription?`、`emptyActionText?`、`total?`、`page?`、`pageSize?`、`rowKey?`、`selectable?` |
| Events | `page-change(page)`、`sort-change({ prop, order })`、`selection-change(rows)`、`empty-action()` |
| Slots | 每个 `column.slot` 或 `column.key` 的单元格插槽；`actions` 行操作插槽。 |

### 3.4 `FormDrawer`

| 项目 | 契约 |
|------|------|
| Props | `modelValue`、`title`、`description?`、`submitText?`、`cancelText?`、`submitLoading?`、`error?`、`width?` |
| Events | `update:modelValue(boolean)`、`submit()`、`cancel()`、`closed()` |
| Slots | 默认插槽为表单主体。 |

### 3.5 `EmptyState` / `ErrorState` / `PageHeader`

| 组件 | Props | Events |
|------|-------|--------|
| `EmptyState` | `title`、`description`、`actionText?`、`actionDisabled?` | `action` |
| `ErrorState` | `message`、`title?`、`retryable?`、`retryText?` | `retry` |
| `PageHeader` | `title`、`description?` | 无；提供 `actions` 插槽 |

### 3.6 `TimetableGrid`

| 项目 | 契约 |
|------|------|
| Props | `weekdays: SelectOption<number>[]`、`periods: SelectOption<number>[]`、`cells?: Record<string, TimetableCell>`、`loading?`、`caption?`、`emptyText?` |
| Events | `cell-click(cell: TimetableCell \| null, coord: { weekday, period })` |
| 信息载体 | 冲突同时使用图标、中文文案和颜色；锁定同时使用「锁」标记与「已锁定」文案。 |

网格键为 `${weekday}:${period}`。`TimetableCell` 包含课次、科目、教师、班级、场地、单双周、冲突和锁定字段。

## 4. Store 与 API 契约

| 模块 | 对外能力 |
|------|----------|
| `useSessionStore` | `user`、`isAuthenticated`、`isAdmin`、`isTeacher`、`mustChangePassword`、`homePath`、`fetchMe`、`login`、`logout`、`clear` |
| `useSemesterStore` | `list`、`current`、`fetch`、`switchTo`；切换后广播 `paike:semester-changed` |
| `useConfirm` | `(options: ConfirmOptions) => Promise<boolean>` |
| `messages.ts` | `MESSAGES`、`friendlyError`、`fieldErrors`、角色/学期/单双周中文标签 |

`http.ts` 的行为：

- 非安全方法先获取并注入 `X-CSRF-Token`；CSRF 校验失败时清除内存 Token 后重试一次。
- 401 清理会话并跳转登录页。
- 409 `VERSION_CONFLICT` 展示中文刷新提示。
- 统一提取中文 `message`；技术枚举、错误码、状态码、SQL 与堆栈不进入用户界面。
- 写请求成功后由页面查询函数刷新数据，不做乐观更新。

## 5. 仍需各域补充的页面

| 域 | 待补页面 |
|----|----------|
| registry | 系统概览、学期管理、作息模板、年级与班级、科目与课时、合班课、走班配置 |
| resource | 教师与任课、场地与功能室 |
| timetable | 一键排课、预排与锁定、多维度课表、拖拽调课、空闲时段、我的课表、我的空闲时段 |
| statistics | 工作量统计 |
| exchange | 批量导入、Excel 导出、模板打印 |
| governance | 冲突校验、操作日志、多学期存档 |
| identity | 用户与角色 |
| auth（P0-08） | 登录页与强制改密页的完整交互、会话失效提示 |

## 6. 验证命令

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run test:e2e
```

`npm test` 中数据库集成测试在未配置 `TEST_DATABASE_URL` 时跳过；已执行的非数据库测试与前端测试必须全部通过。
