# D09 批量导入设计

> 状态：设计态。本文定义固定模板、解析与校验、批次/事务/错误契约、领域应用服务端口和前端导入向导；**不包含业务实现**。
> 权威输入：PRD F18、`p3-contracts.md` §3.3、A-07、H-04、R-038、M-08，以及 `contracts/` 1.0.0。

## 1. 范围与不变量

### 1.1 范围

- 学期、年级、班级、科目、教师、任课、场地七类固定模板下载。
- XLSX 与 UTF-8 CSV 上传、文件级上限、表头校验、前 20 行预览。
- 逐行校验，合法行通过各域应用服务落库，非法行跳过并形成行级 issue。
- `import_batch` 批次记录、批次查询、一次性错误报告 CSV、`operation_log(IMPORT)` 与完成事件。
- `/import` 前端导入向导设计：上传 → 预览 → 二次确认 → 结果 → 错误下载。

### 1.2 非范围

- 不实现 `/grades`、`/classes`、`/subjects`、`/teachers`、`/teaching-assignments` 等域应用服务；D09 只定义并调用它们。
- 不实现 upsert、覆盖导入、课表反导入或用户账号批量开通。
- 不实现 XLSX 导出与打印（D10）。
- 不保存上传原文件或错误 CSV 文件本体；只保存批次元数据和 issue JSONB。

### 1.3 强制不变量

1. `exchange` 是应用编排模块，不拥有 registry/resource 业务表，不直接执行其 DML。
2. 七类模板的列名、自然键、必填项和错误码以本文与 `contracts/` 为准；实现阶段不得自行改名。
3. 文件 >20 MB 或数据行 >5000 必须整份拒绝，零业务写入、零批次写入、零操作日志。
4. 必填列缺失、重复已知列、文件为空或编码/格式非法必须整份拒绝。
5. 预览只解析和校验，不写 `import_batch`、业务表、`operation_log` 或 outbox。
6. 提交必须携带 `confirm=true`；前端二次确认与后端校验双重保证。
7. 重复自然键按行级 `DUPLICATE_KEY` 处理，不覆盖原有记录，不做 upsert。
8. 合法行在单一数据库事务中提交；数据库/基础设施故障回滚全部合法行，并用独立补偿事务写一条 `FAILED` 批次。
9. 一次提交成功收口只写一条 `operation_log`（`module=IMPORT`）和一条 `bc.exchange.import.completed` 事件。
10. 错误 CSV 使用 UTF-8 BOM；首次成功下载后再次下载返回 404，避免报告被重复传播。
11. 不使用 GBK 解析器。CSV 只做严格 UTF-8（含/不含 BOM）解码，失败即整份拒绝。

## 2. 模块结构与领域端口

```text
backend/src/modules/exchange/
├── exchange.router.ts                 # 五个 import 端点
├── import.controller.ts               # multipart、confirm、响应与下载头
├── import.template.ts                 # 七类固定模板定义与 XLSX 生成
├── import.parser.ts                   # XLSX/严格 UTF-8 CSV、表头、行号、空行
├── import.validation.ts               # 文件/表头/行级校验与中文 issue
├── import.service.ts                  # 编排、事务、批次、日志、事件
└── import.query-service.ts            # 批次详情/一次性错误报告
```

`exchange` 只依赖各域导出的应用服务和查询服务。设计端口如下；实施阶段如名称不同，必须先在契约登记偏差。

```ts
type ImportModule = 'SEMESTERS' | 'GRADES' | 'CLASSES' | 'SUBJECTS' | 'TEACHERS' | 'ASSIGNMENTS' | 'VENUES';

type ImportIssueCode =
  | 'REQUIRED_HEADER_MISSING' | 'DUPLICATE_HEADER' | 'UNKNOWN_COLUMN'
  | 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_ENCODING' | 'EMPTY_FILE' | 'PARSE_ERROR'
  | 'ROW_LIMIT_EXCEEDED' | 'FILE_TOO_LARGE'
  | 'REQUIRED_VALUE_MISSING' | 'INVALID_TYPE' | 'INVALID_FORMAT' | 'INVALID_ENUM' | 'INVALID_DATE'
  | 'VALUE_OUT_OF_RANGE' | 'REFERENCE_NOT_FOUND' | 'DUPLICATE_KEY'
  | 'CROSS_FIELD_INVALID' | 'INVALID_SLOT' | 'CONTROLLED_VOCABULARY_MISMATCH'
  | 'DATABASE_FAILURE' | 'TEMPLATE_NOT_FOUND' | 'ERROR_REPORT_CONSUMED';

interface ImportIssue {
  rowNo: number;                 // 表头为 1；首数据行为 2；空行仍占 CSV/工作表行号
  column: string | null;
  rawValue: string | null;
  code: ImportIssueCode;
  severity: 'ERROR' | 'WARNING';
  message: string;               // 中文、可直接展示
}
```

应用服务端口（均接收同一 `Tx`，返回 DTO 或抛出域错误）：

```ts
interface SemesterImportPort { createWithinTransaction(tx: Tx, input: CreateSemesterInput): Promise<SemesterDto>; }
interface GradeImportPort { createWithinTransaction(tx: Tx, input: CreateGradeInput): Promise<GradeDto>; }
interface ClassImportPort { createWithinTransaction(tx: Tx, input: CreateClassInput): Promise<ClassDto>; }
interface SubjectImportPort { createWithinTransaction(tx: Tx, input: CreateSubjectInput): Promise<SubjectDto>; }
interface TeacherImportPort { createWithinTransaction(tx: Tx, input: CreateTeacherInput): Promise<TeacherDto>; }
interface AssignmentImportPort { createWithinTransaction(tx: Tx, input: CreateTeachingAssignmentInput): Promise<TeachingAssignmentDto>; }
interface VenueImportPort { createWithinTransaction(tx: Tx, input: CreateVenueInput): Promise<VenueDto>; }
```

解析自然键需要的只读端口：`TemplateQueryService`、`SemesterQueryService`、`GradeQueryService`、`ClassQueryService`、`SubjectQueryService`、`TeacherQueryService`、`VenueQueryService`。任课导入不按年级限制，班级与年级仅用于解析引用。

## 3. 固定模板与字段契约

### 3.1 通用模板规则

- 下载模板固定为 XLSX，文件名 `导入模板_<中文模块>.xlsx`，首页签名为 `导入数据`，首行为表头。
- 上传接受 `.xlsx`（主格式）和 `.csv`（严格 UTF-8，可含 BOM）；扩展名与 MIME 不可信，按文件签名/解码结果判断。
- 表头按名称匹配，顺序可变；表头先 `trim` 再做 Unicode NFC 归一化。
- 未知列忽略，产生一条 `UNKNOWN_COLUMN/WARNING`，不增加 `failed`。
- 同一已知列名出现两次为整份拒绝（`DUPLICATE_HEADER`），避免取值歧义。
- 空行不计数、不产生错误；数据行数 = 非空逻辑记录数，不含表头。
- `rowNo` 使用用户看到的表格行号：表头第 1 行，首数据行第 2 行；CSV 引号内换行不额外计行，空记录仍占行号。
- 日期接受 `YYYY-MM-DD` 文本或真实 Excel 日期单元格；统一归一化为 `YYYY-MM-DD`。
- 枚举优先使用模板中的中文标签；同时接受契约英文代码（大小写不敏感）。
- 前导/尾随空白去除；姓名、名称、工号中间空白保留后按各域规则校验。

### 3.2 七类模板字段

| module | 固定模板列（顺序） | 必填列 | 自然键 | 关键校验 |
|--------|--------------------|--------|--------|----------|
| `SEMESTERS` | 学期名称、学年、学期类型、开始日期、结束日期、作息模板名称、作息模板版本号 | 全部 | `(学年, 学期类型)` | 名称 1–100；学年 `YYYY-YYYY`；类型 `秋季/春季`；开始 ≤ 结束；模板版本存在且属于指定模板 |
| `GRADES` | 年级名称、排序序号 | 年级名称 | 归一化年级名称 | 名称命中年级受控词表；排序序号可选，缺省追加在现有最大序号之后 |
| `CLASSES` | 年级名称、班级序号、班级人数、班主任工号 | 年级名称、班级序号、班级人数 | `(年级名称, 班级序号)` | 班级名称由服务端生成 `年级（序号）班`；序号 1–99；人数 ≥0；班主任可选且须为在职教师 |
| `SUBJECTS` | 科目名称 | 科目名称 | 归一化科目名称 | 名称命中科目受控词表；不在此模板导入课时规则 |
| `TEACHERS` | 工号、姓名、性别、手机号 | 工号、姓名、性别 | 工号 | 工号 `^T[0-9]+$` 且全表唯一；性别 `男/女/未说明`；手机号可空并做格式校验；导入不自动开通账号 |
| `ASSIGNMENTS` | 教师工号、科目名称、班级名称、每周课时、连堂偏好、场地名称、禁排时段、免排时段 | 教师工号、科目名称、班级名称、每周课时、连堂偏好 | `(教师工号, 班级名称, 科目名称)` 的有效任课 | 教师在职；科目/班级存在；场地可选且可用；周课时 1–99；连堂偏好三值；禁排与免排分别解析、不得合并 |
| `VENUES` | 场地名称、场地类型、容量、状态 | 场地名称、场地类型、容量 | 归一化场地名称 | 名称命中场地受控词表；类型 `教室/功能室`；容量 ≥1；状态 `可用/停用`，缺省 `可用` |

### 3.3 枚举与时段单元格

| 列 | 中文模板值 | 契约值 |
|----|------------|--------|
| 学期类型 | 秋季 / 春季 | `FALL` / `SPRING` |
| 性别 | 男 / 女 / 未说明 | `MALE` / `FEMALE` / `UNSPECIFIED` |
| 连堂偏好 | 无偏好 / 尽量连堂 / 必须连堂 | `NONE` / `PREFERRED` / `REQUIRED` |
| 场地类型 | 教室 / 功能室 | `CLASSROOM` / `FUNCTION_ROOM` |
| 场地状态 | 可用 / 停用 | `AVAILABLE` / `UNAVAILABLE` |

时段单元格为空表示 `[]`。非空格式为 `周一第1节;周三第5-6节`：

- 分隔符接受半角 `;` 或全角 `；`；单个时段接受 `周X第N节` 或 `周X第N-M节`。
- `X ∈ 一..日` 或 `1..7`；节次 `N..M` 展开为连续节次，每项仍须在 1–99。
- 展开后按 `(weekday, period)` 去重并排序；重复项只保留一次，不报错。
- 禁排与免排分别存放，分别显示；同一时段在两列同时出现是允许的。

## 4. 上传、预览与提交流程

```text
POST /import/:module/preview
  -> 文件签名/大小 -> 严格 UTF-8/XLSX 解析 -> 表头 -> 数据行计数
  -> 返回 headers + 前 20 行 + totalRows + headerIssues；0 写库

POST /import/:module (multipart: file + confirm=true)
  -> 重复文件级校验（不得信任预览结果）
  -> 全量行预校验（0 写库）
  -> 单事务：合法行逐个 savepoint 调域应用服务 -> 批次终态 + IMPORT 日志 + outbox
  -> 提交；DB/基础设施失败则整批回滚 + FAILED 补偿批次
```

### 4.1 文件级校验

| 顺序 | 条件 | 结果 | 写入 |
|------|------|------|------|
| 1 | 文件 >20 MB | `413 FILE_TOO_LARGE`，返回实际 MB 与上限 | 零写入、无批次 |
| 2 | 扩展/签名非 XLSX/CSV | `400 VALIDATION_ERROR`，中文说明仅支持格式 | 零写入、无批次 |
| 3 | CSV 非严格 UTF-8 | `400 VALIDATION_ERROR`，`UNSUPPORTED_ENCODING`，不得回退 GBK | 零写入、无批次 |
| 4 | 无表头/无数据行 | `400 VALIDATION_ERROR`，`EMPTY_FILE` | 零写入、无批次 |
| 5 | 数据行 >5000 | `400 VALIDATION_ERROR`，`ROW_LIMIT_EXCEEDED`，返回实际行数与 5000 上限 | 零写入、无批次 |
| 6 | 必填列缺失或重复已知列 | `400 VALIDATION_ERROR`，列出缺失/重复列 | 零写入、无批次 |
| 7 | 未知列 | 继续；记录 `UNKNOWN_COLUMN/WARNING` | 预览/提交报告可见 |

文件级拒绝不创建 `import_batch`。这是“零写入”的直接要求；`FAILED` 批次仅用于已经进入提交、发生全量回滚或全部行非法的情况。

### 4.2 预览

- 请求：`multipart/form-data`，`file` 必填；无需 `confirm`。
- 响应：`headers`、`rows`（最多 20 条原始记录数组）、`totalRows`、`previewLimit=20`、`headerErrors`/issue 列表。
- `headerErrors` 同时包含 `ERROR` 和 `WARNING`；缺失必填列时 `rows=[]`，但仍返回 `totalRows`。
- 预览不写数据库、不写批次、不写日志、不写 outbox。

### 4.3 提交确认

- 提交端点必须有服务端二次确认：`confirm` 字段必须为 `true`，否则返回 `400 VALIDATION_ERROR`。
- 前端弹窗必须展示模块、文件名、数据行数、预计导入行数、失败行数与“非法行会跳过且不会覆盖已有记录”的影响说明；确认按钮文案为“确认导入”。
- `confirm` 不替代文件级/行级校验；任何一次提交都重新解析和校验文件，不信任预览缓存。

## 5. 行级校验与领域调用

### 5.1 校验顺序

1. 必填值存在且非空。
2. 类型/格式：整数、日期、手机号、工号、时段。
3. 枚举/受控词表及跨字段规则。
4. 通过查询服务解析自然键（模板版本、年级、班级、科目、教师、场地）。
5. 在文件内查重，再检查已有有效记录自然键。
6. 调用目标域应用服务；域返回的 `VALIDATION_ERROR`/`DUPLICATE`/引用错误映射为当前行的中文 issue。
7. 任一步失败：该行不写，继续下一行；合法行进入同一批次事务。

### 5.2 自然键与重复处理

| module | 文件内重复 | 与已有记录重复 | 结果 |
|--------|------------|----------------|------|
| `SEMESTERS` | 同一 `(学年, 学期类型)` | 同一 `(学年, 学期类型)` | 后出现行 `DUPLICATE_KEY` |
| `GRADES` | 同名 | 同名 | `DUPLICATE_KEY` |
| `CLASSES` | 同年级同序号 | 同年级同序号 | `DUPLICATE_KEY` |
| `SUBJECTS` | 同名 | 同名 | `DUPLICATE_KEY` |
| `TEACHERS` | 同工号 | 同工号 | `DUPLICATE_KEY` |
| `ASSIGNMENTS` | 同一教师+班级+科目 | 同一有效任课 | `DUPLICATE_KEY` |
| `VENUES` | 归一化同名 | 归一化同名 | `DUPLICATE_KEY` |

重复键行不更新任何字段、不改变原记录版本、不写 outbox；不实现 upsert。

### 5.3 数据库与事务边界

- 行级业务错误不会回滚其他合法行；合法行全部进入同一批次事务。
- 每行调用域应用服务前开 `SAVEPOINT`；域业务错误回滚到 savepoint 并继续。
- 唯一键 SQLSTATE `23505` 可归因于当前自然键时映射为 `DUPLICATE_KEY`；其他数据库错误视为基础设施故障。
- 任一数据库/基础设施故障：回滚整个业务事务（所有合法行、批次终态、日志、outbox），再用独立补偿事务写入 `FAILED` 批次；补偿记录 `success=0`、`failed=total`、`errors` 含 `DATABASE_FAILURE`。
- 补偿写入也失败时返回 `503 DATABASE_UNAVAILABLE`，记录应用日志；不得声称批次已成功。

## 6. 批次表、状态与索引

### 6.1 `import_batch`

设计迁移草案：`docs/knowledge/designs/0032_exchange_import.sql`。实施阶段必须落入 `migrations/0032_exchange_import.sql`。

| 字段 | 类型 | 规则 |
|------|------|------|
| `batch_id` | uuid PK | `gen_random_uuid()`；批次查询键 |
| `module` | `import_module` | 七类固定枚举 |
| `filename` | text | 原文件名；非空 |
| `size_bytes` | integer | ≥0；记录上传大小 |
| `total` | integer | ≥0；数据行，不含表头/空行；`total = success + failed` |
| `success` | integer | ≥0；成功落库行数 |
| `failed` | integer | ≥0；有至少一个 `ERROR` issue 的去重数据行数 |
| `status` | `import_batch_status` | `COMPLETED` / `PARTIAL` / `FAILED` |
| `errors` | jsonb array | `ImportIssue[]`，最多 1000 条；含 WARNING |
| `errors_truncated` | boolean | 超 1000 条时为 true，`failed` 仍为完整计数 |
| `error_report_url` | text null | 有 issue 时 `/api/v1/import/batches/{batchId}/errors` |
| `error_report_downloaded_at` | timestamptz null | 首次成功下载后写入；非空后再下载 404 |
| `operator_id` / `operator_name` | uuid/text | 操作人快照；外键 `sys_user` |
| `created_at` | timestamptz | 批次生成时间 |

状态映射：

| 条件 | status |
|------|--------|
| `failed=0` 且 `success=total` | `COMPLETED` |
| `success>0` 且 `failed>0` | `PARTIAL` |
| `success=0`，包括全部行非法或数据库/基础设施故障 | `FAILED` |

### 6.2 索引

| 索引 | 列/条件 | 用途 |
|------|---------|------|
| `import_batch_pkey` | `batch_id` | 批次详情/错误报告定位 |
| `idx_import_batch_created` | `created_at DESC` | 最近批次列表 |
| `idx_import_batch_operator_created` | `(operator_id, created_at DESC)` | 按操作人追溯 |
| `idx_import_batch_status_created` | `(status, created_at DESC)` | 失败/部分成功排查 |
| `idx_import_batch_module_created` | `(module, created_at DESC)` | 按模块统计与筛选 |

不建立 `errors` GIN 索引：错误仅按批次读取，避免 JSONB 写放大；原始上传文件和 CSV 不落库。

## 7. 错误契约

### 7.1 Issue 结构

```json
{
  "rowNo": 18,
  "column": "教师工号",
  "rawValue": "A1001",
  "code": "INVALID_FORMAT",
  "severity": "ERROR",
  "message": "工号格式应为 T 加数字"
}
```

同一条数据行可有多个 issue，但 `failed` 只按有 `ERROR` 的数据行去重计数；`WARNING` 不影响成功/失败数。

### 7.2 错误码对照

| issue code | severity | 场景 | 中文原因示例 |
|------------|----------|------|--------------|
| `REQUIRED_HEADER_MISSING` | ERROR | 缺必填列，整份拒绝 | 缺少必填列「教师工号」 |
| `DUPLICATE_HEADER` | ERROR | 已知列重复 | 表头「姓名」重复，请保留一列 |
| `UNKNOWN_COLUMN` | WARNING | 未知列忽略 | 未知列「备注」已忽略，不参与导入 |
| `UNSUPPORTED_FORMAT` | ERROR | 非 XLSX/CSV | 仅支持 XLSX 或 UTF-8 CSV 文件 |
| `UNSUPPORTED_ENCODING` | ERROR | CSV 非 UTF-8/GBK | 文件不是 UTF-8 编码，请另存为 UTF-8 后重试 |
| `EMPTY_FILE` | ERROR | 无表头/无数据行 | 文件没有可导入的数据行 |
| `PARSE_ERROR` | ERROR | 损坏/无法解析 | 文件解析失败，请使用系统模板重新填写 |
| `ROW_LIMIT_EXCEEDED` | ERROR | 数据行 >5000 | 当前 5001 行，超过单次上限 5000 行；请拆分文件 |
| `FILE_TOO_LARGE` | ERROR | 文件 >20 MB | 文件超过 20 MB，请拆分后重试 |
| `REQUIRED_VALUE_MISSING` | ERROR | 必填单元格为空 | 必填项不能为空 |
| `INVALID_TYPE` | ERROR | 整数/布尔类型错误 | 请输入整数 |
| `INVALID_FORMAT` | ERROR | 工号/手机号等格式错误 | 工号格式应为 T 加数字 |
| `INVALID_ENUM` | ERROR | 枚举非法 | 学期类型只能是秋季或春季 |
| `INVALID_DATE` | ERROR | 日期非法 | 日期格式应为 YYYY-MM-DD |
| `VALUE_OUT_OF_RANGE` | ERROR | 序号/人数/课时超界 | 班级序号必须在 1-99 之间 |
| `REFERENCE_NOT_FOUND` | ERROR | 年级/班级/科目/教师/场地/模板版本不存在 | 教师工号「T9999」不存在 |
| `DUPLICATE_KEY` | ERROR | 文件内或库内重复 | 工号「T1001」已存在，本次未覆盖 |
| `CROSS_FIELD_INVALID` | ERROR | 开始晚于结束、任课组合不合法等 | 结束日期不能早于开始日期 |
| `INVALID_SLOT` | ERROR | 禁排/免排格式错误 | 时段格式应为「周一第1节」，多个时段用分号分隔 |
| `CONTROLLED_VOCABULARY_MISMATCH` | ERROR | 名称不在受控词表 | 场地名称不在受控词表中 |
| `DATABASE_FAILURE` | ERROR | 提交事务失败 | 数据库写入失败，整批已回滚 |
| `TEMPLATE_NOT_FOUND` | ERROR | module 无固定模板 | 未找到该模块的导入模板 |
| `ERROR_REPORT_CONSUMED` | ERROR | 报告已下载 | 错误报告已下载，不能再次获取 |

`ImportErrorCode` 是行/表头 issue 枚举，不替代 API 全局 `ErrorCode`。文件级上限/编码错误仍使用 `VALIDATION_ERROR` 或 `FILE_TOO_LARGE` 响应码。

## 8. API 与错误报告

### 8.1 端点

| 方法 | 路径 | 契约 |
|------|------|------|
| GET | `/import/templates/:module` | XLSX 固定模板；`Cache-Control: no-store` |
| POST | `/import/:module/preview` | multipart `file`；返回预览，零写库 |
| POST | `/import/:module` | multipart `file + confirm=true`；返回 `ImportBatch` |
| GET | `/import/batches/:batchId` | 批次详情 |
| GET | `/import/batches/:batchId/errors` | 一次性 CSV；UTF-8 BOM |

### 8.2 批次响应

```json
{
  "data": {
    "batchId": "uuid",
    "module": "TEACHERS",
    "filename": "教师导入.xlsx",
    "sizeBytes": 18432,
    "total": 42,
    "success": 39,
    "failed": 3,
    "status": "PARTIAL",
    "errors": [],
    "errorsTruncated": false,
    "errorReportUrl": "/api/v1/import/batches/uuid/errors",
    "operatorId": "uuid",
    "operatorName": "教务管理员",
    "createdAt": "2026-10-19T10:20:00.000Z"
  }
}
```

### 8.3 一次性错误 CSV

- 首次请求在单条 SQL 中原子更新 `error_report_downloaded_at` 并返回 `errors`；已有下载时间返回 `404 NOT_FOUND`，不泄露批次是否存在。
- 列顺序固定：`行号,列名,原值,错误码,严重级别,中文原因`。
- 文件头写 UTF-8 BOM（`EF BB BF`）；响应 `Content-Type: text/csv; charset=utf-8`、`Cache-Control: no-store`。
- 文件名：`import_errors_{module}_{batchId}.csv`。
- 对以 `= + - @` 开头的单元格在 CSV 输出时加前导单引号，防止 Excel 公式注入；API `rawValue` 保持原值。
- 超过 1000 条 issue 时输出前 1000 条，批次 `errorsTruncated=true`；`failed` 始终为完整计数。

## 9. `operation_log` 与事件

仅在提交事务成功收口时写一条：

```json
{
  "module": "IMPORT",
  "action": "批量导入",
  "content": "批量导入教师 42 行（成功 39 行，失败 3 行，批次 uuid）",
  "targetType": "import_batch",
  "targetId": "<batchId>"
}
```

同一事务追加 `bc.exchange.import.completed`，payload 至少包含 `batchId`、`module`、`total`、`success`、`failed`、`status`。数据库故障补偿批次不写操作日志和完成事件，因为提交没有成功。

## 10. 前端导入向导

路由 `/import`，Admin only。页面分四步，任何时刻不把文件内容写入 `localStorage`。

### 10.1 上传

- 模块选择卡（七类）、模板下载按钮、拖拽/选择文件区域。
- 显示格式、20 MB、5000 行限制和“非法行会跳过、不会覆盖已有记录”提示。
- 文件选择后显示文件名、大小；立即调用预览，不在客户端解析业务字段。

### 10.2 预览

- 展示表头校验：缺失必填列红色错误、未知列黄色警告、重复列表头错误。
- 表格显示前 20 行，固定首列行号；不展示可编辑单元格。
- 表头有 ERROR 时禁用“确认导入”，提供“重新选择文件”和“下载模板”。
- 预览请求进行中显示骨架/加载文案；空状态说明原因与下一步。

### 10.3 二次确认

- 必须通过共享 `useConfirm()`，包含操作名称、文件名、模块、总行数、警告数、影响范围、不可撤销说明。
- 确认按钮文案为“确认导入”；取消不发提交请求。
- 提交中禁用重复点击；失败保留向导状态并显示可操作错误。

### 10.4 结果与错误下载

- 结果页显示 `total/success/failed/status` 和批次号；`PARTIAL` 使用警告色并说明合法行已入库。
- 有 issue 时展示“下载错误报告”按钮；点击后按钮变为“报告已下载”，不再重复请求。
- 下载失败（403/404/500）显示“错误报告不可用或已下载，请重新导入需要修正的行”。
- 键盘可达、焦点陷阱、Esc 关闭确认框；颜色不是唯一信息载体，同时使用图标和文案。

## 11. 验证设计

| 验证 | 期望 |
|------|------|
| 5001 行文件 | `400 VALIDATION_ERROR`，提示 5001 行与 5000 上限；业务表/批次/日志零写入 |
| >20 MB 文件 | `413 FILE_TOO_LARGE`，零写入 |
| 缺必填列 | `400 VALIDATION_ERROR`，列出缺失列，零写入、无批次 |
| 含 3 条非法行 | 合法行入库；3 行 issue 均含 rowNo/column/rawValue/code/message；状态 `PARTIAL` |
| 重复键 | 该行 `DUPLICATE_KEY`；原记录字段/版本不变 |
| 预览 20 行 | 返回最多 20 行，`totalRows` 正确；业务表/批次/日志零写入 |
| 提交成功 | 一条 `import_batch`、一条 `operation_log(IMPORT)`、一条完成事件 |
| 数据库故障 | 所有合法行业务写入回滚；补偿批次 `FAILED`、`success=0`、`failed=total` |
| 错误报告 | 首次下载 UTF-8 BOM；第二次 404 |
| GBK CSV | `400`，提示另存 UTF-8；不使用 GBK 解码器 |

业务 API/UI/E2E 用例在实现轮次执行；本轮仅做设计静态验证，详见 `docs/trace/runs/v1/test-results/D09.md`。

## 12. 模板字段与错误码输出摘要

- 模板字段：见 §3.2；七类模板均固定列、自然键和中文枚举标签。
- 错误码：见 §7.2；文件级拒绝使用 HTTP `400/413`，行级 issue 使用 `ImportErrorCode`，错误 CSV 列为 `行号,列名,原值,错误码,严重级别,中文原因`。
- 批次索引：见 §6.2；主键 + 时间、操作人、状态、模块四组查询索引。
