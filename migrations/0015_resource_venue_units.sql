-- =============================================================================
-- D04 · 场地、合班与走班
-- 迁移序号按卡片预留在 0015；依赖 D01-D03 已建立的 registry/resource 表。
-- 成员关系只落关联表，不存数组。
-- =============================================================================

DO $$ BEGIN CREATE TYPE venue_type AS ENUM ('CLASSROOM', 'FUNCTION_ROOM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE venue_status AS ENUM ('AVAILABLE', 'UNAVAILABLE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A-05/A-04：合班与走班名称也进入运行期受控词表，但场地类型仍严格二值。
ALTER TABLE sys_controlled_vocabulary DROP CONSTRAINT IF EXISTS ck_vocab_type;
ALTER TABLE sys_controlled_vocabulary
  ADD CONSTRAINT ck_vocab_type CHECK (
    vocab_type IN ('SUBJECT', 'GRADE', 'VENUE', 'SUBJECT_SYNONYM', 'COMBINED_CLASS', 'WALKING_GROUP')
  );

CREATE TABLE IF NOT EXISTS venue (
  venue_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  type            venue_type NOT NULL,
  capacity        integer NOT NULL CHECK (capacity >= 1),
  status          venue_status NOT NULL DEFAULT 'AVAILABLE',
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL
);

ALTER TABLE venue DROP CONSTRAINT IF EXISTS venue_capacity_check;
ALTER TABLE venue DROP CONSTRAINT IF EXISTS ck_venue_capacity;
ALTER TABLE venue ADD CONSTRAINT ck_venue_capacity CHECK (capacity >= 1);
CREATE UNIQUE INDEX IF NOT EXISTS uq_venue_name_active ON venue (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_venue_type_status ON venue (type, status);

CREATE TABLE IF NOT EXISTS combined_class (
  combined_class_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  teacher_id        uuid NOT NULL REFERENCES teacher(teacher_id),
  venue_id          uuid NOT NULL REFERENCES venue(venue_id),
  period_constraint jsonb NOT NULL DEFAULT '{"slots":[]}'::jsonb,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz NULL
);
ALTER TABLE combined_class ALTER COLUMN venue_id SET NOT NULL;
ALTER TABLE combined_class DROP CONSTRAINT IF EXISTS ck_combined_period_object;
ALTER TABLE combined_class
  ADD CONSTRAINT ck_combined_period_object CHECK (jsonb_typeof(period_constraint) = 'object');
CREATE UNIQUE INDEX IF NOT EXISTS uq_combined_class_name_active ON combined_class (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_combined_class_teacher ON combined_class (teacher_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_combined_class_venue ON combined_class (venue_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS combined_class_member (
  combined_class_id uuid NOT NULL REFERENCES combined_class(combined_class_id) ON DELETE CASCADE,
  class_id          uuid NOT NULL REFERENCES class(class_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (combined_class_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_combined_class_member_class ON combined_class_member (class_id, combined_class_id);

CREATE TABLE IF NOT EXISTS walking_group (
  walking_group_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  subject_id        uuid NOT NULL REFERENCES subject(subject_id),
  teacher_id        uuid NOT NULL REFERENCES teacher(teacher_id),
  venue_id          uuid NOT NULL REFERENCES venue(venue_id),
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_walking_group_name_active ON walking_group (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_walking_group_subject_teacher ON walking_group (subject_id, teacher_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_walking_group_venue ON walking_group (venue_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS walking_group_member (
  walking_group_id  uuid NOT NULL REFERENCES walking_group(walking_group_id) ON DELETE CASCADE,
  class_id          uuid NOT NULL REFERENCES class(class_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (walking_group_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_walking_group_member_class ON walking_group_member (class_id, walking_group_id);

DROP TRIGGER IF EXISTS trg_venue_updated_at ON venue;
CREATE TRIGGER trg_venue_updated_at BEFORE UPDATE ON venue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_combined_class_updated_at ON combined_class;
CREATE TRIGGER trg_combined_class_updated_at BEFORE UPDATE ON combined_class
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_walking_group_updated_at ON walking_group;
CREATE TRIGGER trg_walking_group_updated_at BEFORE UPDATE ON walking_group
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE venue IS '场地/功能室统一主数据；类型二值，容量至少 1';
COMMENT ON TABLE combined_class IS '静态合班配置；作为单个排课单元读取，不持久化科目';
COMMENT ON TABLE walking_group IS '走班组；科目、教师、目标场地与成员班级构成单个排课单元';
