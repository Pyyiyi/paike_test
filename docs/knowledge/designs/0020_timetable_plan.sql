-- =============================================================================
-- D05 · 排课方案与生命周期
-- 设计态交付：方案表、四态枚举、唯一正式方案、乐观版本、生成追踪字段。
-- 实施阶段按 0020_timetable_plan.sql 落入 migrations/。
-- 依赖：registry.semester / schedule_template_version、identity.sys_user、0002 set_updated_at()。
-- =============================================================================

DO $$ BEGIN CREATE TYPE plan_status AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE week_parity AS ENUM ('ALL', 'ODD', 'EVEN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE scheduling_unit_type AS ENUM ('ASSIGNMENT', 'COMBINED_CLASS', 'WALKING_GROUP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE unscheduled_reason AS ENUM ('NO_FEASIBLE_SLOT', 'TEACHER_EXHAUSTED', 'CLASS_EXHAUSTED', 'VENUE_EXHAUSTED', 'CAPACITY', 'LOCK_CONFLICT', 'TIME_LIMIT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE conflict_type AS ENUM ('TEACHER_OVERLAP', 'CLASS_OVERLAP', 'VENUE_OVERLAP', 'CAPACITY_EXCEEDED', 'LOCKED_VIOLATION', 'RULE_VIOLATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE conflict_resolution AS ENUM ('UNRESOLVED', 'IGNORED_ONCE', 'CONFIG_CHANGED', 'RESOLVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE adjustment_action AS ENUM ('APPLY', 'UNDO', 'REDO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS timetable_plan (
  plan_id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id                  uuid NOT NULL REFERENCES semester(semester_id),
  source_plan_id               uuid NULL REFERENCES timetable_plan(plan_id),
  name                         text NOT NULL CHECK (btrim(name) <> ''),
  status                       plan_status NOT NULL DEFAULT 'DRAFT',
  version                      integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  generation_no                integer NOT NULL DEFAULT 0 CHECK (generation_no >= 0),
  schedule_template_version_id uuid NOT NULL REFERENCES schedule_template_version(version_id),
  generation_seed              bigint NULL,
  snapshot_hash                text NULL CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  conflict_count               integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  unscheduled_count            integer NOT NULL DEFAULT 0 CHECK (unscheduled_count >= 0),
  duration_ms                  integer NULL CHECK (duration_ms >= 0),
  has_manual_exemption         boolean NOT NULL DEFAULT false,
  generated_at                 timestamptz NULL,
  generated_by                 uuid NULL REFERENCES sys_user(user_id),
  published_at                 timestamptz NULL,
  published_by                 uuid NULL REFERENCES sys_user(user_id),
  superseded_at                timestamptz NULL,
  archived_at                  timestamptz NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  deleted_at                   timestamptz NULL,
  CONSTRAINT ck_plan_superseded_trace
    CHECK (status <> 'SUPERSEDED' OR superseded_at IS NOT NULL),
  CONSTRAINT ck_plan_archived_trace
    CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);

-- 同一学期任意时刻至多一个正式方案。
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_one_published
  ON timetable_plan (semester_id)
  WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_timetable_plan_semester_status
  ON timetable_plan (semester_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_timetable_plan_source
  ON timetable_plan (source_plan_id)
  WHERE source_plan_id IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_timetable_plan_updated_at ON timetable_plan;
CREATE TRIGGER trg_timetable_plan_updated_at
  BEFORE UPDATE ON timetable_plan
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE timetable_plan IS '排课方案；同学期至多一个 PUBLISHED；生成、发布、覆盖、锁定均按 version 乐观并发';
COMMENT ON COLUMN timetable_plan.generation_no IS '仅在生成/重新生成时递增；用于把一次运行的冲突与忽略审计绑定到同一次运行';
COMMENT ON COLUMN timetable_plan.generation_seed IS '由学期、钉扎模板版本与引擎版本派生的固定种子；不是随机数';
COMMENT ON COLUMN timetable_plan.snapshot_hash IS '规范化输入快照的 SHA-256；用于复现与审计，不在生成时回写源域';
COMMENT ON COLUMN timetable_plan.source_plan_id IS '另存来源；新方案为独立草稿，源方案不变';
