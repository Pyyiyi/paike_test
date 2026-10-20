-- =============================================================================
-- D01 · registry 学期与作息模板（含不可变模板版本、学期钉扎版本）
-- 契约：contracts/schema.sql（Contract 1.0.0）
-- 说明：学期必须绑定一个 schedule_template_version；版本表不可变（无 updated_at）。
-- =============================================================================

DO $$ BEGIN CREATE TYPE term AS ENUM ('FALL', 'SPRING'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE semester_status AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ENDED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE template_status AS ENUM ('ACTIVE', 'RETIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS schedule_template (
  template_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  status            template_status NOT NULL DEFAULT 'ACTIVE',
  latest_version_no integer NOT NULL DEFAULT 1 CHECK (latest_version_no >= 1),
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_template_name_active
  ON schedule_template (lower(name))
  WHERE deleted_at IS NULL;

COMMENT ON TABLE schedule_template IS '作息模板稳定身份；编辑保存生成新版本，不修改历史版本';

CREATE TABLE IF NOT EXISTS schedule_template_version (
  version_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES schedule_template(template_id),
  version_no      integer NOT NULL CHECK (version_no >= 1),
  open_weekdays   smallint[] NOT NULL,
  periods         jsonb NOT NULL,
  status          template_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_schedule_template_version UNIQUE (template_id, version_no),
  CONSTRAINT ck_schedule_template_open_weekdays CHECK (
    cardinality(open_weekdays) > 0 AND open_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
  ),
  CONSTRAINT ck_schedule_template_periods_array CHECK (jsonb_typeof(periods) = 'array')
);

-- 不可变快照：不提供 updated_at，也不加 updated_at 触发器。
COMMENT ON TABLE schedule_template_version IS '作息模板不可变版本；无 updated_at；学期钉扎 version_id';

CREATE TABLE IF NOT EXISTS semester (
  semester_id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  academic_year                text NOT NULL,
  term                         term NOT NULL,
  start_date                   date NOT NULL,
  end_date                     date NOT NULL,
  status                       semester_status NOT NULL DEFAULT 'NOT_STARTED',
  schedule_template_version_id uuid NOT NULL REFERENCES schedule_template_version(version_id),
  is_current                   boolean NOT NULL DEFAULT false,
  version                      integer NOT NULL DEFAULT 1,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  deleted_at                   timestamptz NULL,
  CONSTRAINT ck_semester_dates CHECK (start_date <= end_date),
  CONSTRAINT ck_semester_archived_not_current CHECK (NOT is_current OR status <> 'ARCHIVED')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_semester_current
  ON semester ((is_current))
  WHERE is_current AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_semester_status_dates ON semester (status, start_date DESC);

COMMENT ON TABLE semester IS '学期；is_current 全校至多一个；status 仅 ARCHIVED 为存储态，其余按日期实时推导；存档后只读';

-- updated_at 触发器（仅可编辑表）
DROP TRIGGER IF EXISTS trg_schedule_template_updated_at ON schedule_template;
CREATE TRIGGER trg_schedule_template_updated_at
  BEFORE UPDATE ON schedule_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_semester_updated_at ON semester;
CREATE TRIGGER trg_semester_updated_at
  BEFORE UPDATE ON semester
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
