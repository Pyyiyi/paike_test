-- =============================================================================
-- D03 · 教师主数据与任课约束
-- 设计态交付：表、工号约束、唯一索引、跨域外键与更新时间触发器。
-- 依赖前序 registry/resource 表：class、subject、venue、sys_user。
-- =============================================================================

DO $$
BEGIN
  CREATE TYPE gender AS ENUM ('MALE', 'FEMALE', 'UNSPECIFIED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE teacher_status AS ENUM ('ACTIVE', 'LEFT');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE consecutive_preference AS ENUM ('NONE', 'PREFERRED', 'REQUIRED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS teacher (
  teacher_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_no  text NOT NULL,
  name         text NOT NULL CHECK (btrim(name) <> ''),
  gender       gender NOT NULL DEFAULT 'UNSPECIFIED',
  phone        text NULL,
  status       teacher_status NOT NULL DEFAULT 'ACTIVE',
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL,
  CONSTRAINT uq_teacher_employee_no UNIQUE (employee_no),
  CONSTRAINT ck_teacher_employee_no_format CHECK (employee_no ~ '^T[0-9]+$')
);

CREATE INDEX IF NOT EXISTS idx_teacher_status
  ON teacher (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_name
  ON teacher (name)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS teaching_assignment (
  assignment_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id              uuid NOT NULL REFERENCES teacher(teacher_id),
  subject_id              uuid NOT NULL REFERENCES subject(subject_id),
  class_id                uuid NOT NULL REFERENCES class(class_id),
  venue_id                uuid NULL REFERENCES venue(venue_id),
  weekly_periods          integer NOT NULL CHECK (weekly_periods >= 1),
  consecutive_preference  consecutive_preference NOT NULL DEFAULT 'NONE',
  forbidden_slots         jsonb NOT NULL DEFAULT '[]'::jsonb,
  exempted_slots          jsonb NOT NULL DEFAULT '[]'::jsonb,
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz NULL,
  CONSTRAINT ck_assignment_forbidden_array CHECK (jsonb_typeof(forbidden_slots) = 'array'),
  CONSTRAINT ck_assignment_exempted_array CHECK (jsonb_typeof(exempted_slots) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_assignment_teacher
  ON teaching_assignment (teacher_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assignment_class_subject
  ON teaching_assignment (class_id, subject_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_active_teacher_class_subject
  ON teaching_assignment (teacher_id, class_id, subject_id)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF to_regclass('class') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_class_head_teacher') THEN
    ALTER TABLE class
      ADD CONSTRAINT fk_class_head_teacher
      FOREIGN KEY (head_teacher_id) REFERENCES teacher(teacher_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('sys_user') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sys_user_teacher') THEN
    ALTER TABLE sys_user
      ADD CONSTRAINT fk_sys_user_teacher
      FOREIGN KEY (teacher_id) REFERENCES teacher(teacher_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_teacher_updated_at ON teacher;
CREATE TRIGGER trg_teacher_updated_at
  BEFORE UPDATE ON teacher
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_teaching_assignment_updated_at ON teaching_assignment;
CREATE TRIGGER trg_teaching_assignment_updated_at
  BEFORE UPDATE ON teaching_assignment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE teacher IS
  '教师主数据；employee_no 为 T+数字且全局唯一；status=LEFT 表示退校，deleted_at 表示无引用后的逻辑删除';
COMMENT ON COLUMN teacher.employee_no IS '工号不可编辑；格式 ^T[0-9]+$；退校与逻辑删除均保留原值';
COMMENT ON COLUMN teacher.status IS 'ACTIVE=在职；LEFT=退校；账号状态独立由 identity 管理';
COMMENT ON COLUMN teacher.deleted_at IS '仅在无任何业务引用时由删除动作写入；不得用于退校';
COMMENT ON TABLE teaching_assignment IS
  '任课约束基础数据；免排与禁排分别存储；不限制同一教师的班级或年级数量';
COMMENT ON COLUMN teaching_assignment.forbidden_slots IS
  '禁排：业务规则限定的不可排时段，JSONB 数组 [{weekday,period}]';
COMMENT ON COLUMN teaching_assignment.exempted_slots IS
  '免排：教师主动配置的免排时段，JSONB 数组 [{weekday,period}]；不得与禁排合并';
