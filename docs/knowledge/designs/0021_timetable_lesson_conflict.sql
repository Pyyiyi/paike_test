-- =============================================================================
-- D05 · 课次、未排课时、冲突明细、一次性忽略与调课历史
-- 设计态交付：课次快照、冲突指纹、未排原因/建议、只本次忽略审计、D06 撤销单元。
-- 实施阶段按 0021_timetable_lesson_conflict.sql 落入 migrations/。
-- =============================================================================

CREATE TABLE IF NOT EXISTS lesson (
  lesson_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  weekday        smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  period         smallint NOT NULL CHECK (period BETWEEN 1 AND 20),
  week_parity    week_parity NOT NULL DEFAULT 'ALL',
  subject_id     uuid NOT NULL REFERENCES subject(subject_id),
  teacher_id     uuid NOT NULL REFERENCES teacher(teacher_id),
  venue_id       uuid NULL REFERENCES venue(venue_id),
  unit_type      scheduling_unit_type NOT NULL,
  unit_id        uuid NOT NULL,
  locked         boolean NOT NULL DEFAULT false,
  locked_at      timestamptz NULL,
  locked_by      uuid NULL REFERENCES sys_user(user_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lesson_lock_trace CHECK (
    (locked AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
    OR (NOT locked AND locked_at IS NULL AND locked_by IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_unit_slot
  ON lesson (plan_id, unit_type, unit_id, weekday, period, week_parity);
CREATE INDEX IF NOT EXISTS idx_lesson_plan_weekday_period
  ON lesson (plan_id, weekday, period);
CREATE INDEX IF NOT EXISTS idx_lesson_plan_teacher
  ON lesson (plan_id, teacher_id, weekday, period);
CREATE INDEX IF NOT EXISTS idx_lesson_plan_venue
  ON lesson (plan_id, venue_id, weekday, period)
  WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_plan_locked
  ON lesson (plan_id, locked)
  WHERE locked;
CREATE INDEX IF NOT EXISTS idx_lesson_unit
  ON lesson (unit_type, unit_id);

CREATE TABLE IF NOT EXISTS lesson_class (
  lesson_id  uuid NOT NULL REFERENCES lesson(lesson_id) ON DELETE CASCADE,
  class_id   uuid NOT NULL REFERENCES class(class_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_lesson_class_class
  ON lesson_class (class_id, lesson_id);

CREATE TABLE IF NOT EXISTS unscheduled_lesson (
  unscheduled_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  unit_type           scheduling_unit_type NOT NULL,
  unit_id             uuid NOT NULL,
  class_ids           uuid[] NOT NULL,
  subject_id          uuid NOT NULL REFERENCES subject(subject_id),
  teacher_id          uuid NOT NULL REFERENCES teacher(teacher_id),
  required_periods    integer NOT NULL CHECK (required_periods > 0),
  unplaced_periods    integer NOT NULL CHECK (unplaced_periods > 0),
  reason_code         unscheduled_reason NOT NULL,
  reason_detail       text NOT NULL CHECK (btrim(reason_detail) <> ''),
  suggested_actions   jsonb NOT NULL,
  source_config_refs  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_unscheduled_class_ids_nonempty CHECK (cardinality(class_ids) > 0),
  CONSTRAINT ck_unscheduled_unplaced_range CHECK (unplaced_periods <= required_periods),
  CONSTRAINT ck_unscheduled_actions_array CHECK (
    jsonb_typeof(suggested_actions) = 'array' AND jsonb_array_length(suggested_actions) > 0
  ),
  CONSTRAINT ck_unscheduled_config_refs_array CHECK (jsonb_typeof(source_config_refs) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_unscheduled_plan_unit
  ON unscheduled_lesson (plan_id, unit_type, unit_id);
CREATE INDEX IF NOT EXISTS idx_unscheduled_lesson_plan
  ON unscheduled_lesson (plan_id);
CREATE INDEX IF NOT EXISTS idx_unscheduled_unit
  ON unscheduled_lesson (unit_type, unit_id);

CREATE TABLE IF NOT EXISTS conflict_detail (
  conflict_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  generation_no          integer NOT NULL CHECK (generation_no >= 1),
  fingerprint            text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  lesson_id              uuid NULL REFERENCES lesson(lesson_id) ON DELETE SET NULL,
  conflict_type          conflict_type NOT NULL,
  teacher_id             uuid NULL REFERENCES teacher(teacher_id),
  class_ids              uuid[] NULL,
  venue_id               uuid NULL REFERENCES venue(venue_id),
  weekday                smallint NULL CHECK (weekday BETWEEN 1 AND 7),
  period                 smallint NULL CHECK (period BETWEEN 1 AND 20),
  week_parity            week_parity NOT NULL DEFAULT 'ALL',
  rule_id                text NULL,
  config_ref             jsonb NULL,
  suggestion             text NOT NULL CHECK (btrim(suggestion) <> ''),
  ignorable              boolean NOT NULL DEFAULT false,
  ignore_blocked_reason  text NULL,
  resolution             conflict_resolution NOT NULL DEFAULT 'UNRESOLVED',
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_conflict_ignore_block CHECK (
    NOT ignorable OR ignore_blocked_reason IS NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conflict_plan_generation_fingerprint
  ON conflict_detail (plan_id, generation_no, fingerprint);
CREATE INDEX IF NOT EXISTS idx_conflict_detail_plan_resolution
  ON conflict_detail (plan_id, resolution);
CREATE INDEX IF NOT EXISTS idx_conflict_detail_plan_slot
  ON conflict_detail (plan_id, weekday, period);

-- conflict_id 故意不设外键：重新生成会删除旧 conflict_detail，但忽略审计必须保留。
CREATE TABLE IF NOT EXISTS conflict_ignore (
  ignore_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id               uuid NOT NULL REFERENCES timetable_plan(plan_id),
  generation_no         integer NOT NULL CHECK (generation_no >= 1),
  conflict_id           uuid NULL,
  conflict_fingerprint  text NOT NULL CHECK (conflict_fingerprint ~ '^[0-9a-f]{64}$'),
  conflict_type         conflict_type NOT NULL,
  object_snapshot       jsonb NOT NULL,
  rule_id               text NULL,
  config_ref            jsonb NULL,
  operator_id           uuid NOT NULL REFERENCES sys_user(user_id),
  reason                text NOT NULL CHECK (btrim(reason) <> ''),
  scope                 text NOT NULL DEFAULT 'THIS_RUN' CHECK (scope = 'THIS_RUN'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_conflict_ignore_object CHECK (jsonb_typeof(object_snapshot) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conflict_ignore_run_fingerprint
  ON conflict_ignore (plan_id, generation_no, conflict_fingerprint);
CREATE INDEX IF NOT EXISTS idx_conflict_ignore_plan
  ON conflict_ignore (plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS adjustment_history (
  history_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  session_id     text NOT NULL CHECK (btrim(session_id) <> ''),
  operator_id    uuid NOT NULL REFERENCES sys_user(user_id),
  unit_id        uuid NOT NULL,
  operations     jsonb NOT NULL,
  action         adjustment_action NOT NULL,
  version_before integer NOT NULL CHECK (version_before >= 0),
  version_after  integer NOT NULL CHECK (version_after >= version_before),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_adjustment_operations_array CHECK (
    jsonb_typeof(operations) = 'array' AND jsonb_array_length(operations) > 0
  )
);
CREATE INDEX IF NOT EXISTS idx_adjustment_history_scope
  ON adjustment_history (plan_id, operator_id, session_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_conflict_ignore_append_only ON conflict_ignore;
CREATE TRIGGER trg_conflict_ignore_append_only
  BEFORE UPDATE OR DELETE ON conflict_ignore
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_adjustment_history_append_only ON adjustment_history;
CREATE TRIGGER trg_adjustment_history_append_only
  BEFORE UPDATE OR DELETE ON adjustment_history
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_lesson_updated_at ON lesson;
CREATE TRIGGER trg_lesson_updated_at
  BEFORE UPDATE ON lesson
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE lesson IS '方案内课次；locked=true 的课次在生成、调整、拖拽中均为不可移动锚点';
COMMENT ON TABLE unscheduled_lesson IS '未排课时清单；原因与建议必须可定位，禁止伪造为 0 冲突';
COMMENT ON TABLE conflict_detail IS '一次生成运行的冲突明细；fingerprint 保证稳定去重与审计关联';
COMMENT ON TABLE conflict_ignore IS '只本次忽略的追加写审计；scope 恒为 THIS_RUN，不修改任何配置';
COMMENT ON TABLE adjustment_history IS 'D06 调课撤销单元；一次确认保存为一个不可分割历史单元';
