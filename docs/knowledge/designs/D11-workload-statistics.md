# D11 教师工作量统计设计与口径

> 状态：已实现。本文固定 D11 的查询边界、互斥分类、周/学期口径、空状态与 D10 导出列。
> 权威输入：PRD F14、REQ-AS-001、R-031、A-16、M-17、TC-AS-001~003、TC-AP-015、`p2-contracts.md` §4.4。

## 1. 边界与数据来源

`statistics` 是应用模块，不拥有统计表，也不复制课次数据。

| 数据 | 来源 | 用法 |
|------|------|------|
| 学期与教学周 | `SemesterQueryService` | 校验学期、读取教学周数量与 `ALL/ODD/EVEN` 适用范围 |
| 当前正式方案与课次 | timetable `WorkloadQueryService` | 只读查询 `timetable_plan.status='PUBLISHED'` 及其 `lesson` 行 |
| 教师姓名 | resource `TeacherQueryService` | 按 `teacherId` 批量读取显示名 |

约束：

- 不新增统计表；每次请求实时读取并聚合。
- 不写 `timetable_plan`、`lesson`、`lesson_class` 或主数据表。
- 合班参与班级不参与计数；同一合班课次无论包含多少班级都只贡献 1 节。
- 跨年级任课不设年级维度，统一按 `teacherId` 累计。

## 2. 查询契约

```http
GET /api/v1/statistics/workload?semesterId=<uuid>&scope=SEMESTER|WEEK&weekIndex=<n>
```

- `semesterId` 必填。
- `scope=SEMESTER`：累计学期全部教学周。
- `scope=WEEK`：必须提供 1..`weekCount` 的 `weekIndex`。
- 仅 ADMIN 可访问。
- 学期不存在返回 `404 NOT_FOUND`；参数错误返回 `400 VALIDATION_ERROR`。

响应：

```json
{
  "data": {
    "items": [
      {
        "teacherId": "uuid",
        "teacherName": "张老师",
        "regular": 1,
        "consecutive": 2,
        "combined": 1,
        "overtime": 0,
        "total": 4
      }
    ],
    "scope": "WEEK",
    "weekIndex": 1,
    "weekCount": 18,
    "publishedPlanId": "uuid",
    "message": null
  }
}
```

无当前 `PUBLISHED` 方案时：

```json
{
  "data": {
    "items": [],
    "scope": "SEMESTER",
    "weekIndex": null,
    "weekCount": 18,
    "publishedPlanId": null,
    "message": "请先发布课表"
  }
}
```

## 3. 互斥分类公式

对某个有效教学周中的每条课次 `lesson`：

```text
if lesson.unitType = COMBINED_CLASS:
    combined += 1
else if same(unitType, unitId, teacherId, subjectId, weekday)
        has an effective lesson at period-1 or period+1:
    consecutive += 1
else:
    regular += 1
```

优先级固定为：

```text
合班 > 连堂 > 常规
```

因此同一条课次即使在结构上同时满足“合班”和“连堂”，也只进入 `combined`，不会再进入 `consecutive`。

`overtime` 在 V1.0 恒为 0，不参与 `total`：

```text
total = regular + consecutive + combined
```

## 4. 周与学期口径

`weekIndex` 从 1 开始；第 1 周是单周，之后按奇偶轮换。

```text
effective(lesson, weekIndex) =
    lesson.weekParity = ALL
    OR lesson.weekParity = parityForWeekIndex(weekIndex)
```

周口径：

```text
weekTotals = classify({ lesson | effective(lesson, selectedWeekIndex) })
```

学期口径：

```text
semesterTotals = sum(classify(effectiveLessons(week)) for week in 1..weekCount)
```

这会按每个教学周的真实有效课次逐周分类，而不是先按整学期分类再乘周数。因此当 `ALL` 与 `ODD` 相邻时：

- 单周两条都有效，各计连堂；
- 双周只有 `ALL` 有效，该条计常规；
- 学期汇总等于上述每周结果之和。

## 5. 验收示例

构造同一教师的课次：

| 课次 | 结构 | 计数 |
|------|------|------|
| 合班课 1 条，参与 2 个班 | `COMBINED_CLASS` | 合班 +1 |
| 连堂组第 1 节 | 同一 unit，相邻 period | 连堂 +1 |
| 连堂组第 2 节 | 同一 unit，相邻 period | 连堂 +1 |
| 常规课 1 条 | 无相邻课次 | 常规 +1 |

结果：`regular=1, consecutive=2, combined=1, overtime=0, total=4`。

跨年级示例：同一教师在七年级、八年级、九年级各 1 条常规课，按教师聚合后 `regular=3, total=3`，不按年级拆行。

## 6. D10 导出列

工作量导出必须使用与页面相同的 `WorkloadRow`，不得另写一套分类 SQL。

| 顺序 | 导出列名 | 字段 | 说明 |
|------|----------|------|------|
| 1 | 教师 | `teacherName` | 教师显示名 |
| 2 | 常规 | `regular` | 单节课次数 |
| 3 | 连堂 | `consecutive` | 相邻有效课次实际节数 |
| 4 | 合班 | `combined` | 每节课次按 1 计，不乘参与班级数 |
| 5 | 加班 | `overtime` | 数值恒为 0；V1.0 可附注“细则 V1.1” |
| 6 | 合计 | `total` | `regular + consecutive + combined` |
| 7 | 统计口径 | `scope` | `SEMESTER` 或 `WEEK` |
| 8 | 教学周 | `weekIndex` | 周口径为周序号；学期口径为“全部” |

导出文件元信息建议包含学期名称、`weekCount`、正式方案 `publishedPlanId` 与生成时间；这些字段不得改变逐行统计值。

## 7. 测试落点

- `backend/tests/workload-statistics.test.ts`：五类验收场景、优先级、奇偶逐周分类、跨年级累计、空状态。
- `backend/tests/statistics-router.test.ts`：路由、权限参数校验、空结果响应契约。
- `backend/tests/statistics.integration.test.ts`：基于真实 PostgreSQL 的 `PUBLISHED` 方案、课次读取、教师姓名和合计断言。
- `frontend/src/views/statistics/WorkloadStatisticsView.test.ts`：四列、V1.1 占位、口径切换和「请先发布课表」。
