-- =============================================================================
-- D06 · 五视图、空闲查询、调课与撤销重做的查询/审计索引
-- 设计态交付：只补索引，不建表、不改列、不改枚举。
-- 前置：D05 的 0020_timetable_plan.sql 与 0021_timetable_lesson_conflict.sql。
-- 实施阶段按 0022_timetable_adjustment_indexes.sql 落入 migrations/。
-- =============================================================================

-- 方案解析：/timetables 与 /idle-slots 按 semester 选 PUBLISHED 或最新 DRAFT。
CREATE INDEX IF NOT EXISTS idx_timetable_plan_semester_active
  ON timetable_plan (semester_id, updated_at DESC)
  WHERE deleted_at IS NULL AND status IN ('DRAFT', 'PUBLISHED');

-- 五视图：按方案 + 周次 + 槽位读取；单双周过滤与稳定排序。
CREATE INDEX IF NOT EXISTS idx_lesson_plan_parity_slot
  ON lesson (plan_id, week_parity, weekday, period);

CREATE INDEX IF NOT EXISTS idx_lesson_plan_weekday_period_parity
  ON lesson (plan_id, weekday, period, week_parity);

-- 教师视图/教师空闲：同一教师按方案与槽位读取。
CREATE INDEX IF NOT EXISTS idx_lesson_plan_teacher_parity
  ON lesson (plan_id, teacher_id, weekday, period, week_parity);

-- 场地视图/场地空闲：只索引实际指定场地的课次。
CREATE INDEX IF NOT EXISTS idx_lesson_plan_venue_parity
  ON lesson (plan_id, venue_id, weekday, period, week_parity)
  WHERE venue_id IS NOT NULL;

-- 任课/合班/走班视图：按教学单元读取。
CREATE INDEX IF NOT EXISTS idx_lesson_plan_unit_slot
  ON lesson (plan_id, unit_type, unit_id, weekday, period, week_parity);

-- 科目名称与统计辅助：按方案 + 科目读取。
CREATE INDEX IF NOT EXISTS idx_lesson_plan_subject
  ON lesson (plan_id, subject_id);

-- 调课历史：按方案读取时间线。
CREATE INDEX IF NOT EXISTS idx_adjustment_history_plan_created
  ON adjustment_history (plan_id, created_at DESC);

-- 撤销/重做：按「方案 + 用户 + 编辑会话 + 单元」定位最新历史并重放。
CREATE INDEX IF NOT EXISTS idx_adjustment_history_replay
  ON adjustment_history (plan_id, operator_id, session_id, unit_id, created_at DESC)
  INCLUDE (action, operations, version_before, version_after);

-- 撤销/重做：按动作筛选当前会话的 APPLY/UNDO/REDO。
CREATE INDEX IF NOT EXISTS idx_adjustment_history_action
  ON adjustment_history (plan_id, action, created_at DESC);

-- 幂等：同一会话的同一 unitId 只能有一个 APPLY；网络重试不会重复落库。
CREATE UNIQUE INDEX IF NOT EXISTS uq_adjustment_history_apply_unit
  ON adjustment_history (plan_id, operator_id, session_id, unit_id)
  WHERE action = 'APPLY';

-- 操作日志：按目标对象（调课目标为 TIMETABLE_PLAN）追溯，支持学期隔离查询。
CREATE INDEX IF NOT EXISTS idx_operation_log_target_created
  ON operation_log (target_type, target_id, created_at DESC);

COMMENT ON INDEX idx_adjustment_history_replay IS 'D06 撤销/重做按单元读取最新历史；覆盖 action/operations/version 字段';
COMMENT ON INDEX uq_adjustment_history_apply_unit IS 'D06 一次确认保存一个 APPLY 单元；同会话 unitId 幂等';
