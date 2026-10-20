-- =============================================================================
-- D01 · registry 校历例外（停课 / 调休上课）
-- 契约：contracts/schema.sql（Contract 1.0.0）
-- 停课周占用教学周序号，奇偶继续推进（H-05）；调休按 makeup_weekday 映射课表。
-- =============================================================================

DO $$ BEGIN CREATE TYPE calendar_exception_type AS ENUM ('STOP', 'MAKEUP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS calendar_exception (
  exception_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id    uuid NOT NULL REFERENCES semester(semester_id),
  type           calendar_exception_type NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  makeup_weekday smallint NULL CHECK (makeup_weekday BETWEEN 1 AND 7),
  note           text NULL,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_calendar_exception_dates CHECK (start_date <= end_date),
  CONSTRAINT ck_calendar_exception_makeup CHECK (type <> 'MAKEUP' OR makeup_weekday IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_calendar_exception_semester_date
  ON calendar_exception (semester_id, start_date);

COMMENT ON TABLE calendar_exception IS '校历例外：停课（STOP）/ 调休上课（MAKEUP）；停课周仍占教学周序号';

DROP TRIGGER IF EXISTS trg_calendar_exception_updated_at ON calendar_exception;
CREATE TRIGGER trg_calendar_exception_updated_at
  BEFORE UPDATE ON calendar_exception
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
