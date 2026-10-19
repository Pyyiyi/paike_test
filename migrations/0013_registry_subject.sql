-- =============================================================================
-- D02 · registry 科目与课时规则
-- 科目名受控；同义词命中拒绝；三开关独立存储且默认 false。
-- =============================================================================

DO $$
BEGIN
  CREATE TYPE consecutive_preference AS ENUM ('NONE', 'PREFERRED', 'REQUIRED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE time_slot_preference AS ENUM ('NONE', 'MORNING', 'AFTERNOON');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS subject (
  subject_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_name_active
  ON subject (lower(name)) WHERE deleted_at IS NULL;

COMMENT ON TABLE subject IS '科目主数据；名称受控且同义词不得并存；被任课引用时禁止删除';

CREATE TABLE IF NOT EXISTS subject_period_rule (
  rule_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id                 uuid NOT NULL UNIQUE REFERENCES subject(subject_id),
  weekly_periods             integer NOT NULL CHECK (weekly_periods >= 0),
  consecutive_preference     consecutive_preference NOT NULL DEFAULT 'NONE',
  forbidden_slots            jsonb NOT NULL DEFAULT '[]'::jsonb,
  time_slot_preference       time_slot_preference NOT NULL DEFAULT 'NONE',
  period_balance_enabled     boolean NOT NULL DEFAULT false,
  am_pm_balance_enabled      boolean NOT NULL DEFAULT false,
  fixed_slot_rule_enabled    boolean NOT NULL DEFAULT false,
  version                    integer NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_subject_period_rule_forbidden_array
    CHECK (jsonb_typeof(forbidden_slots) = 'array')
);

COMMENT ON TABLE subject_period_rule IS '科目课时规则；三开关独立存储默认 false；保存前做禁排/固定时段冲突检测';

DROP TRIGGER IF EXISTS trg_subject_updated_at ON subject;
CREATE TRIGGER trg_subject_updated_at
  BEFORE UPDATE ON subject
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_subject_period_rule_updated_at ON subject_period_rule;
CREATE TRIGGER trg_subject_period_rule_updated_at
  BEFORE UPDATE ON subject_period_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
