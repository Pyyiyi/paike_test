# D10 Excel 导出与模板打印设计

> 状态：设计态。本文定义 XLSX 列字典、三维度导出、打印模板、受保护 HTML、一次性 token 与单一 PDF 渲染契约；**不包含业务实现、页面实现或已执行运行时测试**。
> 权威输入：PRD F15/F16、R-032/R-033、H-03/H-04、M-11/M-14、`p3-contracts.md` §3.4/§3.5，以及 D05/D06/D11 设计。

## 1. 范围、依赖与不变量

### 1.1 范围

- `COLUMN_DICTIONARY`：基础数据、课表、统计三维度的列名、顺序、Sheet、取值类型和格式化规则的唯一来源。
- `GET /exports/options`、`GET /exports/columns`、`POST /exports` 的导出契约。
- 基础数据 8 个实体 Sheet；课表 5 个视图 Sheet；统计 1 个 Sheet。
- `print_template` 模板 CRUD、3 个预设模板、PNG 校徽上传与预设删除保护。
- 服务端受保护 HTML、Playwright Chromium `renderPdf`、PDF 短期缓存、预览/打印字节一致。
- 一次性 token、临时文件 10 分钟清理、安全审计与领域事件。
- `/export`、`/print` 前端页面和预览交互契约。
- 设计迁移草案：`docs/knowledge/designs/0033_exchange_print.sql`。

### 1.2 非范围

- 不实现或修改 `registry`、`resource`、`timetable`、`statistics` 的查询服务；`exchange` 只调用其导出端口。
- 不把 `0033_*` 放入 `migrations/`，不实现服务、路由、Repository、Vue 页面或 E2E。
- 不引入 SheetJS 之外的第二套 XLSX 生成器，不引入 Playwright 之外的打印引擎。
- 不把 XLSX/PDF 长期落库，不保存用户上传的原始校徽文件。
- 不导出 `SCHOOL` 打印；模板打印 V1.0 只支持班级、教师两种课表。
- 不实现加班统计细则；统计导出只复用 D11 已有 `WorkloadRow`。

### 1.3 依赖状态

| 依赖 | 当前基线 | D10 使用方式 |
|------|----------|--------------|
| D01 学期/模板/校历 | QueryService 已实现 | 读取学期名称、学年、日期、状态、模板名称/版本、周次与节次时间 |
| D02 年级/班级/科目 | 设计态 | 读取页面同名字段；实现前补齐批量只读查询方法 |
| D03 教师/任课 | 设计态 | 读取教师、任课页面字段；只读，不写 resource |
| D04 场地/合班/走班 | QueryService 已实现 | 读取场地与合班；基础数据 V1.0 Sheet 按 p3 只列合班，不新增走班导出 |
| D05/D06 课次/五视图 | 设计态 | 复用 `TimetableViewQueryService` 的同一课次/单元格 DTO |
| D11 工作量统计 | 已实现 | 直接复用 `WorkloadStatisticsService` 与 `WorkloadRow` |
| P0-01/P0-03 | 已实现 | `sys_audit_log`、outbox、统一错误包络、固定时钟 |

> `exchange` 不 import 其他域 Repository，不直接 join registry/resource/timetable 私有表。所有名称、显示值、排序和权限过滤由对方 QueryService 提供。

### 1.4 强制不变量

1. `COLUMN_DICTIONARY` 是列名、列序、Sheet 顺序与显示格式的唯一来源；页面和导出禁止各自维护列数组。
2. 导出行的每个值必须来自页面同源的 QueryService DTO；不得在 `exchange` 中重算统计、课表分类或名称映射。
3. XLSX 只写值：不写公式、宏、外部链接、批注或远程图片；日期写 `YYYY-MM-DD` 字符串，时间写 `HH:mm` 字符串。
4. `null` 写为空单元格，不写空字符串、`null`、`-` 或占位文案；布尔值按字典格式写“是/否”。
5. 所有 Sheet 冻结首行表头；文件名固定为 `{维度}_{学期}_{YYYYMMDDHHmm}.xlsx`，并做路径分隔符净化。
6. 导出文件只存在 `EXPORT_TMP_DIR`，成功流式响应后立即删除；清理任务每分钟扫描并删除超过 10 分钟的文件。
7. 导出不要求二次确认，只写 `sys_audit_log` 和 `bc.exchange.export.completed`，不写 `operation_log`。
8. 打印模板名称在未删除记录内大小写不敏感唯一；编辑与校徽替换必须携带当前 `version`，冲突零写入。
9. 校徽只接受 PNG 文件签名，解码后 ≤2 MiB；SVG/伪装 PNG 返回 `400`，超限返回 `413 FILE_TOO_LARGE`。
10. 三个预设模板不可逻辑删除或物理删除；预设删除返回 `409 STATE_CONFLICT`。
11. 打印 HTML 只能通过 60 秒一次性 token 访问；token 为 256-bit 随机值，只保存 SHA-256，消费后立即失效，URL 不记录原始 token。
12. 预览与打印必须调用同一个 HTML 模板和同一个 `renderPdf`；相同 `renderKey` 返回同一份 PDF 字节，不做第二次渲染。
13. 打印预览与打印均写 `sys_audit_log` 和 `bc.exchange.print.rendered`；渲染或审计失败不得返回 PDF。
14. 打印只支持 `CLASS` / `TEACHER`；参数中出现其他维度返回 `400 VALIDATION_ERROR`。
15. 已存档学期只读但允许导出和打印；课表读取必须使用该学期正式方案，不得串学期。

## 2. 模块结构与只读端口

```text
backend/src/modules/exchange/
├── exchange.router.ts              # exports 与 print 路由
├── export.column-dictionary.ts    # COLUMN_DICTIONARY 唯一常量
├── export.service.ts              # 维度校验、查询编排、审计、事件
├── export.workbook.ts             # SheetJS 工作簿、冻结表头、格式化
├── export.temp-file.ts            # 10 分钟 TTL 与清理
├── print-template.service.ts      # CRUD、乐观锁、预设保护
├── print-template.logo.ts         # PNG 签名/大小校验、data URI
├── print.render.service.ts        # renderKey、短缓存、PDF 指标
├── print.html.ts                  # 受保护 HTML/CSS 模板
├── print.token-store.ts           # 60 秒一次性 token
└── print.pdf.ts                   # Playwright renderPdf 单例
```

所需只读端口（名称可调整，但必须在实现前登记契约偏差）：

```ts
interface MasterDataExportPort {
  semesters(semesterId: string): Promise<SemesterExportRow[]>;
  grades(semesterId: string): Promise<GradeExportRow[]>;
  classes(semesterId: string): Promise<ClassExportRow[]>;
  subjects(semesterId: string): Promise<SubjectExportRow[]>;
  teachers(semesterId: string): Promise<TeacherExportRow[]>;
  assignments(semesterId: string): Promise<AssignmentExportRow[]>;
  venues(semesterId: string): Promise<VenueExportRow[]>;
  combinedClasses(semesterId: string): Promise<CombinedClassExportRow[]>;
}

interface TimetableExportPort {
  read(input: {
    semesterId: string;
    dimension: 'CLASS' | 'TEACHER' | 'SCHOOL' | 'VENUE' | 'ASSIGNMENT';
    objectIds?: string[];
    parity: 'ALL' | 'ODD' | 'EVEN';
  }): Promise<TimetableExportCell[]>;
}

interface StatisticsExportPort {
  read(input: {
    semesterId: string;
    scope: 'SEMESTER' | 'WEEK';
    weekIndex?: number;
  }): Promise<WorkloadStatisticsResult>;
}
```

`TimetableExportPort` 必须复用 `TimetableViewQueryService`；`StatisticsExportPort` 必须复用 D11 的 `WorkloadStatisticsService`。若实现时端口名称或返回 DTO 不同，先修改本文件与 OpenAPI，再写代码。

## 3. 列字典唯一来源

### 3.1 数据类型

```ts
type ColumnValueType = 'STRING' | 'DATE' | 'TIME' | 'NUMBER' | 'BOOLEAN' | 'ENUM';

interface ColumnDefinition {
  key: string;
  label: string;
  order: number;                 // 同一 Sheet 内从 1 连续
  sheetKey: string;              // 稳定英文键，用于前端与测试
  sheetName: string;             // 用户可见中文 Sheet 名，≤31 字符
  valueType: ColumnValueType;
  format?: 'YYYY-MM-DD' | 'HH:mm' | 'YES_NO' | 'JOIN_IDEOGRAPHIC';
  nullable: boolean;
}

interface ColumnDictionary {
  dimension: 'MASTER_DATA' | 'TIMETABLE' | 'STATISTICS';
  columns: ColumnDefinition[];
}
```

`GET /exports/columns?dimension=` 返回扁平 `columns` 数组；同一 `sheetKey` 的行按 `sheetName` 首次出现顺序建立 Sheet，并按 `order` 排序。`GET /exports/options` 同时返回三维度、学期、课表维度和当前字典版本 `1`。前端不得排序或改写 label。

### 3.2 基础数据 `MASTER_DATA`

Sheet 顺序固定为：`学期`、`年级`、`班级`、`科目`、`教师`、`任课`、`场地`、`合班`。

| Sheet | 顺序 | 导出列名 | key | 值类型/格式 | 页面来源 |
|-------|:---:|----------|-----|-------------|----------|
| 学期 | 1 | 学年 | academicYear | STRING | 学期列表 |
| 学期 | 2 | 学期 | name | STRING | 学期列表 |
| 学期 | 3 | 开始日期 | startDate | DATE / `YYYY-MM-DD` | 起止日期左值 |
| 学期 | 4 | 结束日期 | endDate | DATE / `YYYY-MM-DD` | 起止日期右值 |
| 学期 | 5 | 引用作息模板 | scheduleTemplateName | STRING | 学期列表 |
| 学期 | 6 | 作息模板版本 | scheduleTemplateVersionNo | NUMBER | 学期列表 |
| 学期 | 7 | 状态 | status | ENUM | 学期列表中文状态 |
| 年级 | 1 | 年级名称 | name | STRING | 年级区 |
| 年级 | 2 | 班级数 | classCount | NUMBER | 年级区 |
| 班级 | 1 | 班级 | name | STRING | 班级区 |
| 班级 | 2 | 年级 | gradeName | STRING | 班级区 |
| 班级 | 3 | 班主任 | headTeacherName | STRING，空值为空 | 班级区 |
| 班级 | 4 | 人数 | studentCount | NUMBER | 班级区 |
| 科目 | 1 | 科目 | name | STRING | 科目列表 |
| 科目 | 2 | 每周课时 | weeklyPeriods | NUMBER | 科目列表 |
| 科目 | 3 | 连堂偏好 | consecutivePreference | ENUM | 科目列表 |
| 科目 | 4 | 禁排时段 | forbiddenSlots | STRING | 科目列表格式 |
| 科目 | 5 | 时段优先 | timeSlotPreference | ENUM | 科目列表 |
| 教师 | 1 | 工号 | employeeNo | STRING | 教师主数据 |
| 教师 | 2 | 姓名 | name | STRING | 教师主数据 |
| 教师 | 3 | 性别 | gender | ENUM | 教师主数据 |
| 教师 | 4 | 手机号 | phone | STRING，空值为空 | 教师主数据 |
| 教师 | 5 | 状态 | status | ENUM | 教师主数据 |
| 教师 | 6 | 登录账号 | accountStatus | ENUM，未开通为空 | 教师主数据 |
| 任课 | 1 | 教师 | teacherName | STRING | 任课表 |
| 任课 | 2 | 科目 | subjectName | STRING | 任课表 |
| 任课 | 3 | 班级 | classNames | STRING / 顿号连接 | 任课表 |
| 任课 | 4 | 场地 | venueName | STRING，空值为空 | 任课表 |
| 任课 | 5 | 每周课时 | weeklyPeriods | NUMBER | 任课表 |
| 任课 | 6 | 免排时段 | exemptedSlots | STRING，空值为空 | 任课表 |
| 场地 | 1 | 场地名称 | name | STRING | 场地列表 |
| 场地 | 2 | 类型 | type | ENUM | 场地列表中文类型 |
| 场地 | 3 | 容量 | capacity | NUMBER | 场地列表 |
| 场地 | 4 | 可用状态 | status | ENUM | 场地列表中文状态 |
| 场地 | 5 | 排课说明 | schedulingNote | STRING，空值为空 | 场地列表 |
| 合班 | 1 | 合班课名称 | name | STRING | 合班列表 |
| 合班 | 2 | 参与班级 | classNames | STRING / 顿号连接 | 合班列表 |
| 合班 | 3 | 教师 | teacherName | STRING | 合班列表 |
| 合班 | 4 | 场地 | venueName | STRING，空值为空 | 合班列表 |
| 合班 | 5 | 节次约束 | periodConstraint | STRING，空值为空 | 合班列表 |

学期页面的“起止日期”由一个视觉单元格组成；R-032 的逐字段一致性以底层 `startDate` / `endDate` 两个合同字段导出，页面与导出的格式化结果相同。

### 3.3 课表 `TIMETABLE`

按 `timetableDimension` 生成 5 个 Sheet，顺序固定：`班级`、`教师`、`全校`、`场地`、`任课`。每个 Sheet 使用同一 12 列行契约；每行代表一个非空课次坐标，不导出空格。

| 顺序 | 导出列名 | key | 格式/取值 |
|:---:|----------|-----|-----------|
| 1 | 对象类型 | objectType | 中文：班级/教师/全校/场地/任课 |
| 2 | 对象名称 | objectName | 页面当前对象；全校固定为“全校” |
| 3 | 星期 | weekday | 周一…周日 |
| 4 | 节次 | period | 整数 |
| 5 | 开始时间 | startTime | TIME / `HH:mm` |
| 6 | 结束时间 | endTime | TIME / `HH:mm` |
| 7 | 科目 | subjectName | STRING，空值为空 |
| 8 | 教师 | teacherName | STRING，空值为空 |
| 9 | 班级 | classNames | STRING / 顿号连接，空值为空 |
| 10 | 场地 | venueName | STRING，空值为空；普通教室空值 |
| 11 | 单双周 | weekParity | ENUM `ALL` / `ODD` / `EVEN` |
| 12 | 锁定 | locked | BOOLEAN / `是` / `否` |

12 列同时作为 1000×12 性能基准的字段宽度。`ALL/ODD/EVEN` 是内部合同值，页面与导出都按该枚举取值；中文显示与否不得改变底层值。

### 3.4 统计 `STATISTICS`

Sheet 固定为 `工作量统计`，列字典直接映射 D11 §6 的 `WorkloadRow`，不新增分类 SQL；统计导出直接复用 D11 查询，不在 exchange 重算。

| 顺序 | 导出列名 | key | 格式/取值 |
|:---:|----------|-----|-----------|
| 1 | 教师 | teacherName | STRING |
| 2 | 常规 | regular | NUMBER |
| 3 | 连堂 | consecutive | NUMBER |
| 4 | 合班 | combined | NUMBER |
| 5 | 加班 | overtime | NUMBER / V1.0 恒为 0 |
| 6 | 合计 | total | NUMBER |
| 7 | 统计口径 | scope | ENUM `SEMESTER` / `WEEK` |
| 8 | 教学周 | weekIndex | WEEK 为整数；SEMESTER 为“全部” |

无正式课表时统计 Sheet 不写数据行，工作簿元信息仍包含学期与“请先发布课表”提示；不得用 0 行伪造统计。

## 4. 导出契约

### 4.1 请求与 Sheet 编排

- `MASTER_DATA`：忽略 `timetableDimension`，按 §3.2 写 8 个 Sheet；空实体写表头，无数据行。
- `TIMETABLE`：`timetableDimension` 必填；`objectIds` 为空时按页面权限/当前筛选返回可导出对象；班级/教师/场地/任课每个对象一个 Workbook 内 Sheet，Sheet 名 `{中文维度}-{对象名}` 截断到 31 字符并去重。
- `STATISTICS`：可带 `scope=WEEK` 与 `weekIndex`；缺省 `SEMESTER`。
- 文件名维度使用中文显示值：`基础数据` / `课表` / `统计`；学期使用 `semester.name` 净化；时间由注入时钟生成。
- 已存档学期允许导出；跨学期 ID 返回 `404 NOT_FOUND`，不得回退当前学期。

### 4.2 XLSX 格式

- 工作簿使用 SheetJS `bookType: 'xlsx'`，每个 Sheet 第一行为字典 label，顺序与 `order` 严格一致。
- 日期/时间值统一先格式化为字符串再写单元格，不写 Date 对象，避免时区和 Excel 自定义格式漂移。
- 冻结首行：sheet view 的 `pane` 锚定 `A2`，`ySplit=1`，`topLeftCell='A2'`，`activePane='bottomLeft'`，`state='frozen'`。
- 空值写空单元格；不写公式、宏、外链、批注、图片；列宽可按 label 设置，内容值不得改动。
- 响应头：`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`；`Content-Disposition: attachment; filename*=UTF-8''...`；`Cache-Control: no-store`。

### 4.3 性能与临时文件

- 数据读取使用单次 `REPEATABLE READ` 快照；同一工作簿只读一次各域查询，避免 N+1。
- 1000 行 × 12 列基准数据集从 `TIMETABLE` 口径生成，计时覆盖查询、格式化、XLSX 序列化和落盘；p95 以至少 20 次冷热混合运行计算。
- 目标 p95 ≤3000ms（`PERF_EXPORT_P95_MS`）；超出阈值记录 `operation=EXPORT dimension=... durationMs=... rowCount=...`，不静默降级。
- 每次生成写入 `EXPORT_TMP_DIR` 唯一文件；响应完成或异常后删除。每分钟清理超过 10 分钟的残留文件，启动时也执行一次。
- 实现轮次的性能测试才可回填实测值；本设计不声称已通过。

### 4.4 审计与事件

导出成功后写一条 `sys_audit_log`：`action='EXPORT'`、操作人、学期、维度、课表维度、行数、文件名、耗时；不记录单元格内容。

同一写事务追加 `bc.exchange.export.completed`，payload 至少含 `dimension`、`semesterId`、`objectCount`、`rowCount`、`durationMs`、`filename`。导出不属于七类关键操作，不写 `operation_log`、不弹二次确认。

## 5. 打印模板

### 5.1 数据模型

`print_template` 以 `0033_exchange_print.sql` 为准：

| 字段 | 约束 |
|------|------|
| `template_id` | uuid 主键 |
| `name` | 去空白非空、≤100；未删除记录内 `lower(name)` 唯一 |
| `paper_size` | `A4` / `A3` |
| `orientation` | `PORTRAIT` / `LANDSCAPE` |
| `margin_mm` | `{top,right,bottom,left}`，四项毫米整数 0..50；扣除边距后至少 20mm |
| `title` | 可为空，≤200 |
| `logo_data_uri` | PNG data URI，解码后 ≤2 MiB；禁止 SVG/远程 URL |
| `header_text` / `footer_text` | 可为空，各 ≤500 |
| `is_preset` | 预置标记；预设不可删除 |
| `version` | 创建 0，编辑/换校徽 +1，PATCH 必须匹配 |
| `created_at` / `updated_at` / `deleted_at` | 时间戳；逻辑删除 |

模板列表按 `is_preset DESC, lower(name), template_id` 稳定排序。创建返回 201；名称重复返回 `409 DUPLICATE`；版本过期返回 `409 VERSION_CONFLICT` 且零写入。

### 5.2 预设模板

| 名称 | 纸张 | 方向 | 边距(mm) | 标题 | 可删除 |
|------|------|------|----------|------|:------:|
| 标准课表 · 校徽版 | A4 | LANDSCAPE | 10/10/10/10 | 课表 | 否 |
| 紧凑版（A4 横） | A4 | LANDSCAPE | 6/6/6/6 | 课表 | 否 |
| 教师手册版 | A4 | PORTRAIT | 12/12/12/12 | 教师课表 | 否 |

预设可在套用时复制为自定义模板再编辑；删除预设一律返回 `409 STATE_CONFLICT`，数据库触发器兜底逻辑删除和物理删除。预设缺失视为种子迁移失败，启动健康检查记录错误但不自动重建用户已改数据。

### 5.3 校徽上传

- `POST /print-templates/:id/logo` 为 `multipart/form-data`，字段 `logo`（单文件）和 `version`（整数，必填）。
- 先检查 `Content-Length`/文件大小；原始文件 >2,097,152 bytes 返回 `413 FILE_TOO_LARGE`，提示文件超过 2 MB，不读入内存。
- MIME、扩展名不可信；校验 PNG 8 字节签名 `89 50 4E 47 0D 0A 1A 0A`，SVG/伪装 PNG 400；签名不符统一返回 `400 VALIDATION_ERROR`。
- 通过后转 `data:image/png;base64,...` 存储，替换旧 logo 并 `version+1`；失败零写入。
- 上传限制只针对校徽；导入的 20 MB 上限不能复用于校徽，错误码仍为 `FILE_TOO_LARGE` 但文案按端点区分。

## 6. 受保护 HTML、PDF 与 token

### 6.1 单一渲染链

```text
preview/render request
  -> validate admin + template + semester + CLASS/TEACHER
  -> read one timetable snapshot via TimetableViewQueryService
  -> renderKey = sha256(templateId + templateVersion + snapshotHash + parity)
  -> if cached PDF for renderKey: reuse bytes
  -> else: issue one-time token -> Playwright loads protected HTML -> consume token
  -> renderPdf(page, template, format/landscape/margins) -> PDF bytes
  -> cache PDF bytes (10 min, keyed by renderKey)
  -> audit + bc.exchange.print.rendered
  -> stream same bytes for preview and render
```

- HTML 模板由 `print.html.ts` 生成，只使用内联 CSS、系统字体和 data URI 校徽；不得加载外网资源。
- HTML 的 `@page` 使用模板的纸张、方向和边距；打印区域只渲染所选班级/教师课表，末页空行由 CSS 分页处理。
- `renderPdf` 使用 Playwright Chromium：进程内复用 browser；每次 new context/page；`page.emulateMedia({ media: 'print' })`；等待 `document.fonts.ready` 和两张 `requestAnimationFrame`；调用 `page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: PRINT_TIMEOUT_MS })`。
- 不调用第二套打印引擎，不在客户端生成 PDF。
- 预览与 render 仅 Content-Disposition 不同（inline/download）；PDF 字节、页数、尺寸、标题、校徽位置和表单字段必须一致。

### 6.2 token

- `/print/html/:token` 为内部受保护 HTML 地址，token 是 256-bit `randomBytes(32)` 的 base64url，只保存 SHA-256。
- token 记录：`jtiHash`、`renderKey`、`expiresAt = now + 60_000ms`、`consumedAt`；消费与过期判断在同一事件循环原子完成。
- 首次成功加载即标记 consumed；过期、重复、篡改统一返回 `401 UNAUTHENTICATED`，不返回 HTML 片段或原因。
- HTML 响应头：`Cache-Control: no-store`、`Pragma: no-cache`、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'`。
- token 只作为路径参数，不接受 query/body；不写日志、不写审计原文；token store 每分钟清扫过期项，进程重启后所有未消费 token 失效。
- 60 秒从 token 签发时计算，不因页面跳转/重试延长；实现测试注入固定时钟验证边界。

### 6.3 PDF 缓存与临时文件

- 缓存键 `renderKey` 包含模板版本和课表 `snapshotHash`；数据变更生成新键，不复用旧 PDF。
- 缓存内存上限建议 32 份/64 MiB，先按 TTL 10 分钟淘汰，再按最后访问时间淘汰；缓存值同时写 `PRINT_TMP_DIR` 临时文件以便流式响应，均在 10 分钟内清理。
- 并发相同 `renderKey` 用一个 in-flight Promise 去重，禁止两个 Chromium 页面同时生成同一 PDF。
- 响应 `ETag: "sha256-<hex>"`；客户端可用 `If-None-Match` 获取 304，但 304 不改变“同一份 PDF”语义。

### 6.4 PDF 耗时指标

`renderPdf` 结果记录以下字段，写入结构化日志与测试报告：

| 字段 | 含义 |
|------|------|
| `browserLaunchMs` | 首次启动/复用 Chromium 的耗时 |
| `htmlLoadMs` | 受保护 HTML 页面加载与字体就绪 |
| `pdfRenderMs` | `page.pdf` 调用耗时 |
| `totalDurationMs` | 从 renderKey 命中判断到 PDF bytes 完成 |
| `pdfBytes` | PDF 字节数 |
| `pageCount` | 渲染页数 |
| `cacheHit` | 是否复用缓存 |

设计态不提供实测值；实现轮次以 20 次预热后的 p50/p95 记录，并至少覆盖 A4 横版 5×8 格、A3 横版、A4 纵版和 2MB 校徽。任何单次超过 `PRINT_TIMEOUT_MS=30000` 返回 503/500，不返回半成品 PDF。

## 7. API 契约

### 7.1 导出

`GET /exports/options` 返回 `dimensions`、`semesters`、`timetableDimensions`、`columnDictionaryVersion=1`。`GET /exports/columns?dimension=` 返回 §3 的扁平列定义。`POST /exports` 接受：

```json
{
  "dimension": "TIMETABLE",
  "semesterId": "uuid",
  "timetableDimension": "CLASS",
  "objectIds": ["uuid"],
  "parity": "ALL"
}
```

`dimension` 只能是 `MASTER_DATA`/`TIMETABLE`/`STATISTICS`；`STATISTICS` 的 `scope` 只接受 `SEMESTER`/`WEEK`，`WEEK` 必填 1..weekCount 的 `weekIndex`。返回 200 XLSX；参数错误 400，未登录 401，非 ADMIN 403，学期不存在 404，存档学期只读允许导出，服务端错误 500。

### 7.2 打印模板

`GET /print-templates`、`POST /print-templates`、`PATCH /print-templates/:id`、`DELETE /print-templates/:id`、`POST /print-templates/:id/logo` 按 §5。模板不存在 404；名称重复/版本冲突/预设删除 409；上传超限 413；SVG 或伪装 PNG 400。

### 7.3 预览、打印与 HTML

`POST /print/preview` 与 `POST /print/render` 接受同一 `PrintRenderRequest`，只允许 `dimension=CLASS|TEACHER`、必填 `semesterId`、`parity`，`templateId` 必须存在且未删除。成功返回同一 PDF bytes；`/print/html/:token` 只接受一次性 token，返回 `text/html`，失败 401。

打印成功/预览成功均写 `sys_audit_log`（`action=PRINT_PREVIEW|PRINT_RENDER`）和 `bc.exchange.print.rendered`；事件 payload 含 `templateId`、`semesterId`、`dimension`、`objectId`、`renderKey`、`pageCount`、`pdfBytes`、`durationMs`，不写 token 原文。

## 8. 前端契约

### 8.1 `/export`

- 维度选择：基础数据 / 课表 / 统计；切换维度清空不适用字段。
- 学期默认当前学期，允许选择已存档学期；课表维度额外显示视图（班级/教师/全校/场地/任课）和对象选择。
- 选择维度后请求 `/exports/columns`，用返回 label/order 渲染预览表头；不得在 Vue 中写死列数组。
- 导出按钮不弹二次确认；请求期间禁用按钮并显示行数/耗时；下载失败显示统一错误包络，不生成假文件。
- 文件名由服务端 `Content-Disposition` 决定，前端不得自行拼写。

### 8.2 `/print`

- 模板列表分预设/自定义，支持套用、编辑、逻辑删除；删除预设按钮置灰并显示 409 文案。
- 模板表单字段：名称、纸张 A4/A3、横/纵向、四边距、标题、页眉、页脚、校徽；校徽前端只做即时 PNG/2MB 提示，服务端仍强制校验。
- 选择学期 + 班级/教师 + 单双周，点击预览请求 `/print/preview`，用返回 PDF Blob 在 `<iframe>` 展示。
- 打印按钮请求 `/print/render` 并用返回的同一 PDF Blob 下载/交给浏览器打印；若预览后数据快照未变，服务端应按 `renderKey` 命中同一 bytes。
- 页面必须显示 PDF `pageCount`、生成耗时和“预览与打印为同一文件”的提示；渲染失败不展示占位 PDF。

## 9. 验证矩阵

| 编号 | 断言 | 设计证据 | 执行轮次验证 |
|------|------|----------|--------------|
| D10-01 | 三维度与列字典单一来源 | §3、§7.1、静态 `exchange-export-print-design.test.ts` | 页面/导出字段比对 |
| D10-02 | XLSX 值、日期/时间、空值、冻结表头 | §4.2、§3、静态测试 | SheetJS 读取 + 解压 XML pane 断言 |
| D10-03 | 1000×12 p95 ≤3s | §4.3 | 固定数据集 20 次基准 |
| D10-04 | 文件名含维度与学期、可被 Excel 打开 | §4.1/§4.2 | Content-Disposition + Excel/LibreOffice 打开 |
| D10-05 | 模板字段、PNG、边距、预设保护 | §5、`0033_exchange_print.sql` | CRUD/上传/撤销测试 |
| D10-06 | 预览/打印同一 PDF | §6.1/§6.3 | preview/render bytes sha256 相等 |
| D10-07 | token 60 秒一次性 | §6.2 | 注入时钟 + 重复访问 401 |
| D10-08 | 导出/打印安全审计 | §4.4/§7.3 | `sys_audit_log` 行断言 |
| D10-09 | 存档学期可导出、不串学期 | §1.4/§4.1 | 两学期锚点交叉请求 |

## 10. 设计态结论

本轮交付的是可机械校验的契约与迁移/测试草案；不声称 API、XLSX 文件、Chromium PDF、性能或 UI 已执行通过。实现轮次必须先补 D02/D03 查询端口，再按 §9 运行性能、逐字段一致、PDF 字节一致和 token 过期/重放测试。若实现与本文冲突，先修改本文件、`p3-contracts.md` 和 `contracts/`，再改代码。
