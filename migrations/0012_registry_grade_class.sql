-- =============================================================================
-- D02 · registry 年级与班级
-- 班级名称由服务端生成：{年级名}（{序号}）班；序号 1-99 整数。
-- 班主任外键在 teacher 表存在时补充，保证 D03 未落地前迁移可独立执行。
-- =============================================================================

CREATE TABLE IF NOT EXISTS grade (
  grade_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grade_name_active
  ON grade (lower(name)) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_grade_sort_order
  ON grade (sort_order) WHERE deleted_at IS NULL;

COMMENT ON TABLE grade IS '年级主数据；名称必须来自受控词表 GRADE；被班级引用时禁止删除';

CREATE TABLE IF NOT EXISTS class (
  class_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_id        uuid NOT NULL REFERENCES grade(grade_id),
  name            text NOT NULL,
  serial_no       smallint NOT NULL CHECK (serial_no BETWEEN 1 AND 99),
  head_teacher_id uuid NULL,
  student_count   integer NOT NULL CHECK (student_count >= 0),
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL,
  CONSTRAINT ck_class_name_generated CHECK (name ~ '（[1-9][0-9]?）班$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_grade_serial_active
  ON class (grade_id, serial_no) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_class_head_teacher
  ON class (head_teacher_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE class IS '班级主数据；名称仅由服务端生成，前端不得提交';

DO $$
BEGIN
  IF to_regclass('teacher') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'fk_class_head_teacher'
     ) THEN
    ALTER TABLE class
      ADD CONSTRAINT fk_class_head_teacher
      FOREIGN KEY (head_teacher_id) REFERENCES teacher(teacher_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_grade_updated_at ON grade;
CREATE TRIGGER trg_grade_updated_at
  BEFORE UPDATE ON grade
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_class_updated_at ON class;
CREATE TRIGGER trg_class_updated_at
  BEFORE UPDATE ON class
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
