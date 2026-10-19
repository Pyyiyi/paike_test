# 排课单元查询契约（D04 → D05）

D04 不实现排课。它只保存场地、合班、走班配置，并通过 `SchedulingUnitQueryService` 向 D05 提供只读快照。

## 1. 单元字段

| 字段 | 类型 | 合班 | 走班 | 说明 |
|------|------|------|------|------|
| `unitId` | UUID | ✓ | ✓ | `combinedClassId` / `walkingGroupId` |
| `unitType` | enum | `COMBINED_CLASS` | `WALKING_GROUP` | 只用于 D04 资源单元 |
| `name` | string | ✓ | ✓ | 受控词表名称 |
| `subjectId` | UUID \| null | `null` | ✓ | 合班不持久化科目（A-04） |
| `teacherId` | UUID | ✓ | ✓ | 在职教师 |
| `venueId` | UUID | ✓ | ✓ | 合班和走班都必须配置目标场地 |
| `classIds` | UUID[] | ✓ | ✓ | 非空；去重；按 UUID 字典序稳定排序 |
| `periodConstraint` | object | ✓ | 空约束 | `{ slots: Slot[] }`，按 `(weekday, period)` 排序 |

`Slot = { weekday: 1..7, period: 1..20 }`。`slots: []` 表示未附加节次偏好；D05 仍需按教师、班级、场地占用执行硬约束。

JSON 示例：

```json
{
  "unitId": "00000000-0000-4000-8000-000000000301",
  "unitType": "COMBINED_CLASS",
  "name": "体育合班",
  "subjectId": null,
  "teacherId": "00000000-0000-4000-8000-000000000302",
  "venueId": "00000000-0000-4000-8000-000000000303",
  "classIds": [
    "00000000-0000-4000-8000-000000000304",
    "00000000-0000-4000-8000-000000000305"
  ],
  "periodConstraint": {
    "slots": [{ "weekday": 3, "period": 7 }]
  }
}
```

## 2. D05 快照输入

D05 在生成方案前调用：

```ts
const units = await schedulingUnitQueryService.list();
```

输入边界：

- 只返回未删除的合班/走班；结果按 `unitType`、`name`、`unitId` 稳定排序。
- 每个单元一次返回教师、目标场地和全部参与班级；D05 不得拆成单班课次。
- H2/H8 对 `classIds` 全部逐班检查；H3 对 `venueId` 检查；H4 通过 `VenueQueryService.getCapacity(venueId)` 与 D02 班级人数联合校验。
- 任一单元被排课方案中的 `lesson.unit_type + lesson.unit_id` 或 `unscheduled_lesson.unit_type + unscheduled_lesson.unit_id` 引用时，D04 删除接口返回 `409 REFERENCE_PROTECTED`。
- `ASSIGNMENT` 单元由 D03 任课数据提供，不混入本查询结果。

## 3. 配置写入契约

- 场地：类型二值 `CLASSROOM` / `FUNCTION_ROOM`；容量 ≥ 1；名称命中 `VENUE` 受控词表且未删除记录内唯一。
- 合班：名称命中 `COMBINED_CLASS`；至少 2 个不同且存在的班级；教师在职；场地存在。
- 走班：名称命中 `WALKING_GROUP`；至少 1 个不同且存在的班级；科目、教师、目标场地均存在。
- 成员关系只写 `combined_class_member` / `walking_group_member`，不以数组存于主表。
- 所有编辑携带 `version`；版本不一致返回 `409 VERSION_CONFLICT`。
