-- =============================================================================
-- 智能排课系统 V1.0 — 契约冻结数据库 DDL
-- contractVersion: 1.0.0
-- 范围：8 张共享表 + 26 张领域/应用支撑表，共 34 张表
-- 依据：schema-shared.sql、p0~p3-contracts.md、conventions.md §10
-- 本文件可在空 PostgreSQL 16 数据库中直接执行；重复执行保持幂等。
-- =============================================================================

-- =============================================================================
-- P0-01 · 共享基础设施表
-- 8 张共享表：迁移账本、账号、会话、登录尝试、运行配置、受控词表、发件箱、安全审计
-- UUID 主键遵循 schema-shared.sql；本文件不创建任何领域表。
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('ADMIN', 'TEACHER');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE account_status AS ENUM ('ENABLED', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 1. sys_migration — 迁移账本
CREATE TABLE IF NOT EXISTS sys_migration (
  migration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename     text        NOT NULL UNIQUE,
  checksum     text        NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  duration_ms  integer     NOT NULL DEFAULT 0,
  applied_by   text        NOT NULL DEFAULT current_user,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sys_migration IS '已执行的数据库迁移文件账本；只追加，不修改历史记录';

-- 2. sys_user — 本地账号（bc-identity 的持久化载体）
CREATE TABLE IF NOT EXISTS sys_user (
  user_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username             text           NOT NULL,
  display_name         text           NOT NULL,
  password_hash        text           NOT NULL,
  role                 user_role      NOT NULL,
  status               account_status NOT NULL DEFAULT 'ENABLED',
  must_change_password boolean        NOT NULL DEFAULT true,
  teacher_id           uuid           NULL,
  last_login_at        timestamptz    NULL,
  password_changed_at  timestamptz    NULL,
  version              integer        NOT NULL DEFAULT 1,
  created_at           timestamptz    NOT NULL DEFAULT now(),
  updated_at           timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT uq_sys_user_username UNIQUE (username),
  CONSTRAINT ck_sys_user_username_format CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  CONSTRAINT ck_sys_user_teacher_link CHECK (
    (role = 'TEACHER' AND teacher_id IS NOT NULL)
    OR (role = 'ADMIN' AND teacher_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_teacher
  ON sys_user (teacher_id)
  WHERE teacher_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sys_user_role_status
  ON sys_user (role, status);

COMMENT ON TABLE sys_user IS '本地账号；Argon2id 哈希；首次登录强制改密；停用账号下一请求即拒绝';
COMMENT ON COLUMN sys_user.teacher_id IS 'Teacher 账号关联的教师主数据；Admin 为空';

-- 3. sys_session — 服务端会话（express-session 持久化）
CREATE TABLE IF NOT EXISTS sys_session (
  sid          text PRIMARY KEY,
  user_id      uuid        NULL REFERENCES sys_user(user_id) ON DELETE CASCADE,
  data         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_sys_session_user
  ON sys_session (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sys_session_expires
  ON sys_session (expires_at);

COMMENT ON TABLE sys_session IS '服务端会话；退出或停用账号时置 revoked_at；绝对过期由 expires_at 控制';

-- 4. sys_login_attempt — 登录失败与锁定
CREATE TABLE IF NOT EXISTS sys_login_attempt (
  attempt_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text        NOT NULL,
  ip_address     inet        NOT NULL,
  success        boolean     NOT NULL,
  failure_reason text        NULL,
  attempted_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sys_login_attempt_lookup
  ON sys_login_attempt (username, ip_address, attempted_at DESC);

COMMENT ON TABLE sys_login_attempt IS '登录尝试审计；用于失败计数与锁定判定；不记录密码';

-- 5. sys_config — 运行期配置（非机密）
CREATE TABLE IF NOT EXISTS sys_config (
  config_key   text PRIMARY KEY,
  config_value jsonb       NOT NULL,
  description  text        NOT NULL DEFAULT '',
  updated_by   uuid        NULL REFERENCES sys_user(user_id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sys_config IS '非敏感运行配置；机密配置（数据库密码、Session Secret）只允许环境变量';

-- 6. sys_controlled_vocabulary — 受控词表与同义词
CREATE TABLE IF NOT EXISTS sys_controlled_vocabulary (
  vocabulary_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vocab_type     text        NOT NULL,
  canonical_name text        NOT NULL,
  synonym_of     text        NULL,
  sort_order     integer     NOT NULL DEFAULT 0,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_vocab_type CHECK (vocab_type IN ('SUBJECT', 'GRADE', 'VENUE', 'SUBJECT_SYNONYM', 'COMBINED_CLASS', 'WALKING_GROUP')),
  CONSTRAINT ck_vocab_synonym CHECK (
    (vocab_type = 'SUBJECT_SYNONYM' AND synonym_of IS NOT NULL)
    OR (vocab_type <> 'SUBJECT_SYNONYM')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vocab_type_name
  ON sys_controlled_vocabulary (vocab_type, canonical_name);

CREATE INDEX IF NOT EXISTS idx_vocab_type_active
  ON sys_controlled_vocabulary (vocab_type, is_active, sort_order);

COMMENT ON TABLE sys_controlled_vocabulary IS '受控名称与同义词；新增科目/年级/场地时校验；同义词命中即拒绝';

-- 7. sys_outbox_event — 领域事件发件箱
CREATE TABLE IF NOT EXISTS sys_outbox_event (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name     text        NOT NULL,
  schema_version integer     NOT NULL DEFAULT 1,
  aggregate_type text        NOT NULL,
  aggregate_id   uuid        NOT NULL,
  payload        jsonb       NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  occurred_by    uuid        NULL REFERENCES sys_user(user_id),
  published_at   timestamptz NULL,
  attempt_count  integer     NOT NULL DEFAULT 0,
  last_error     text        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON sys_outbox_event (occurred_at)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
  ON sys_outbox_event (aggregate_type, aggregate_id);

COMMENT ON TABLE sys_outbox_event IS '事务性发件箱；未发布事件按 occurred_at 顺序投递；至少一次语义';

-- 8. sys_audit_log — 安全审计（追加写）
CREATE TABLE IF NOT EXISTS sys_audit_log (
  audit_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        NULL REFERENCES sys_user(user_id),
  actor_name  text        NULL,
  action      text        NOT NULL,
  target_type text        NULL,
  target_id   uuid        NULL,
  result      text        NOT NULL,
  ip_address  inet        NULL,
  user_agent  text        NULL,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_audit_result CHECK (result IN ('SUCCESS', 'FAILURE', 'DENIED'))
);

CREATE INDEX IF NOT EXISTS idx_audit_actor_time
  ON sys_audit_log (actor_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action_time
  ON sys_audit_log (action, occurred_at DESC);

COMMENT ON TABLE sys_audit_log IS '安全审计日志；只追加；无更新/删除 API；记录登录、锁定、改密、角色变更、越权';

-- 9. 基础配置种子（非业务数据）
INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('session.idleHours', '8'::jsonb, '会话空闲超时（小时）'),
  ('session.absoluteDays', '7'::jsonb, '会话绝对过期（天）'),
  ('login.maxFailures', '5'::jsonb, '15 分钟内允许的最大失败次数'),
  ('login.lockMinutes', '15'::jsonb, '锁定分钟数'),
  ('import.maxRows', '5000'::jsonb, '单次导入最大数据行'),
  ('import.maxFileMb', '20'::jsonb, '单次导入最大文件大小（MB）'),
  ('password.minLength', '8'::jsonb, '密码最小长度'),
  ('password.requiredClasses', '3'::jsonb, '密码至少包含的字符类别数')
ON CONFLICT (config_key) DO NOTHING;


-- =============================================================================
-- P0-01 · updated_at 触发器
-- 所有共享表都必须自动维护 updated_at。
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sys_migration_updated_at ON sys_migration;
CREATE TRIGGER trg_sys_migration_updated_at
  BEFORE UPDATE ON sys_migration
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_user_updated_at ON sys_user;
CREATE TRIGGER trg_sys_user_updated_at
  BEFORE UPDATE ON sys_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_session_updated_at ON sys_session;
CREATE TRIGGER trg_sys_session_updated_at
  BEFORE UPDATE ON sys_session
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_login_attempt_updated_at ON sys_login_attempt;
CREATE TRIGGER trg_sys_login_attempt_updated_at
  BEFORE UPDATE ON sys_login_attempt
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_config_updated_at ON sys_config;
CREATE TRIGGER trg_sys_config_updated_at
  BEFORE UPDATE ON sys_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_vocab_updated_at ON sys_controlled_vocabulary;
CREATE TRIGGER trg_sys_vocab_updated_at
  BEFORE UPDATE ON sys_controlled_vocabulary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_outbox_event_updated_at ON sys_outbox_event;
CREATE TRIGGER trg_sys_outbox_event_updated_at
  BEFORE UPDATE ON sys_outbox_event
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_audit_log_updated_at ON sys_audit_log;
CREATE TRIGGER trg_sys_audit_log_updated_at
  BEFORE UPDATE ON sys_audit_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- Contract 1.0.0 · 领域枚举（数据库/API/前端拼写必须一致）
-- =============================================================================
DO $$ BEGIN CREATE TYPE term AS ENUM ('FALL', 'SPRING'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE semester_status AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ENDED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE template_status AS ENUM ('ACTIVE', 'RETIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE calendar_exception_type AS ENUM ('STOP', 'MAKEUP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE gender AS ENUM ('MALE', 'FEMALE', 'UNSPECIFIED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE teacher_status AS ENUM ('ACTIVE', 'LEFT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE venue_type AS ENUM ('CLASSROOM', 'FUNCTION_ROOM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE venue_status AS ENUM ('AVAILABLE', 'UNAVAILABLE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE consecutive_preference AS ENUM ('NONE', 'PREFERRED', 'REQUIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE time_slot_preference AS ENUM ('NONE', 'MORNING', 'AFTERNOON'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE plan_status AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE week_parity AS ENUM ('ALL', 'ODD', 'EVEN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE scheduling_unit_type AS ENUM ('ASSIGNMENT', 'COMBINED_CLASS', 'WALKING_GROUP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE conflict_type AS ENUM ('TEACHER_OVERLAP', 'CLASS_OVERLAP', 'VENUE_OVERLAP', 'CAPACITY_EXCEEDED', 'LOCKED_VIOLATION', 'RULE_VIOLATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE conflict_resolution AS ENUM ('UNRESOLVED', 'IGNORED_ONCE', 'CONFIG_CHANGED', 'RESOLVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE unscheduled_reason AS ENUM ('NO_FEASIBLE_SLOT', 'TEACHER_EXHAUSTED', 'CLASS_EXHAUSTED', 'VENUE_EXHAUSTED', 'CAPACITY', 'LOCK_CONFLICT', 'TIME_LIMIT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE adjustment_action AS ENUM ('APPLY', 'UNDO', 'REDO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE import_module AS ENUM ('SEMESTERS', 'GRADES', 'CLASSES', 'SUBJECTS', 'TEACHERS', 'ASSIGNMENTS', 'VENUES'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE import_batch_status AS ENUM ('COMPLETED', 'PARTIAL', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE export_dimension AS ENUM ('MASTER_DATA', 'TIMETABLE', 'STATISTICS'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE timetable_dimension AS ENUM ('CLASS', 'TEACHER', 'SCHOOL', 'VENUE', 'ASSIGNMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE operation_module AS ENUM ('DELETE', 'PUBLISH', 'OVERWRITE', 'SWITCH_SEMESTER', 'IMPORT', 'ARCHIVE', 'ADJUST'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE print_paper_size AS ENUM ('A4', 'A3'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE print_orientation AS ENUM ('PORTRAIT', 'LANDSCAPE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- Registry / Resource（Phase 1）
-- =============================================================================
CREATE TABLE IF NOT EXISTS teacher (
  teacher_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_no     text NOT NULL,
  name            text NOT NULL,
  gender          gender NOT NULL DEFAULT 'UNSPECIFIED',
  phone           text NULL,
  status          teacher_status NOT NULL DEFAULT 'ACTIVE',
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL,
  CONSTRAINT uq_teacher_employee_no UNIQUE (employee_no),
  CONSTRAINT ck_teacher_employee_no_format CHECK (employee_no ~ '^T[0-9]+$')
);
CREATE INDEX IF NOT EXISTS idx_teacher_status ON teacher (status);
CREATE INDEX IF NOT EXISTS idx_teacher_name ON teacher (name);

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
CREATE UNIQUE INDEX IF NOT EXISTS uq_venue_name_active ON venue (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_venue_type_status ON venue (type, status);

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
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_template_name_active ON schedule_template (lower(name)) WHERE deleted_at IS NULL;

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

CREATE TABLE IF NOT EXISTS semester (
  semester_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text NOT NULL,
  academic_year               text NOT NULL,
  term                        term NOT NULL,
  start_date                  date NOT NULL,
  end_date                    date NOT NULL,
  status                      semester_status NOT NULL DEFAULT 'NOT_STARTED',
  schedule_template_version_id uuid NOT NULL REFERENCES schedule_template_version(version_id),
  is_current                  boolean NOT NULL DEFAULT false,
  version                     integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz NULL,
  CONSTRAINT ck_semester_dates CHECK (start_date <= end_date),
  CONSTRAINT ck_semester_archived_not_current CHECK (NOT is_current OR status <> 'ARCHIVED')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_semester_current ON semester ((is_current)) WHERE is_current AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_semester_status_dates ON semester (status, start_date DESC);

CREATE TABLE IF NOT EXISTS calendar_exception (
  exception_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id     uuid NOT NULL REFERENCES semester(semester_id),
  type            calendar_exception_type NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  makeup_weekday  smallint NULL CHECK (makeup_weekday BETWEEN 1 AND 7),
  note            text NULL,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_calendar_exception_dates CHECK (start_date <= end_date),
  CONSTRAINT ck_calendar_exception_makeup CHECK (type <> 'MAKEUP' OR makeup_weekday IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_calendar_exception_semester_date ON calendar_exception (semester_id, start_date);

CREATE TABLE IF NOT EXISTS grade (
  grade_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_grade_name_active ON grade (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS subject (
  subject_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_name_active ON subject (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS class (
  class_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_id        uuid NOT NULL REFERENCES grade(grade_id),
  name            text NOT NULL,
  serial_no       smallint NOT NULL CHECK (serial_no BETWEEN 1 AND 99),
  head_teacher_id uuid NULL REFERENCES teacher(teacher_id),
  student_count   integer NOT NULL CHECK (student_count >= 0),
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_class_grade_serial_active ON class (grade_id, serial_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_head_teacher ON class (head_teacher_id) WHERE deleted_at IS NULL;

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
  CONSTRAINT ck_subject_period_rule_forbidden_array CHECK (jsonb_typeof(forbidden_slots) = 'array')
);

CREATE TABLE IF NOT EXISTS combined_class (
  combined_class_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  teacher_id        uuid NOT NULL REFERENCES teacher(teacher_id),
  venue_id          uuid NOT NULL REFERENCES venue(venue_id),
  period_constraint jsonb NOT NULL DEFAULT '{"slots":[]}'::jsonb,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz NULL,
  CONSTRAINT ck_combined_period_object CHECK (jsonb_typeof(period_constraint) = 'object')
);
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
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz NULL,
  CONSTRAINT ck_assignment_forbidden_array CHECK (jsonb_typeof(forbidden_slots) = 'array'),
  CONSTRAINT ck_assignment_exempted_array CHECK (jsonb_typeof(exempted_slots) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_assignment_teacher ON teaching_assignment (teacher_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assignment_class_subject ON teaching_assignment (class_id, subject_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_active_teacher_class_subject
  ON teaching_assignment (teacher_id, class_id, subject_id) WHERE deleted_at IS NULL;

ALTER TABLE sys_user DROP CONSTRAINT IF EXISTS fk_sys_user_teacher;
ALTER TABLE sys_user ADD CONSTRAINT fk_sys_user_teacher FOREIGN KEY (teacher_id) REFERENCES teacher(teacher_id);
DROP INDEX IF EXISTS uq_sys_user_username_lower;
CREATE UNIQUE INDEX uq_sys_user_username_lower ON sys_user (lower(username));

-- =============================================================================
-- Timetable（Phase 2）
-- =============================================================================
CREATE TABLE IF NOT EXISTS timetable_plan (
  plan_id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id                  uuid NOT NULL REFERENCES semester(semester_id),
  name                         text NOT NULL,
  status                       plan_status NOT NULL DEFAULT 'DRAFT',
  version                      integer NOT NULL DEFAULT 0,
  schedule_template_version_id uuid NOT NULL REFERENCES schedule_template_version(version_id),
  conflict_count               integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  unscheduled_count            integer NOT NULL DEFAULT 0 CHECK (unscheduled_count >= 0),
  duration_ms                  integer NULL CHECK (duration_ms >= 0),
  has_manual_exemption         boolean NOT NULL DEFAULT false,
  generated_at                 timestamptz NULL,
  generated_by                 uuid NULL REFERENCES sys_user(user_id),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  deleted_at                   timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_one_published
  ON timetable_plan (semester_id) WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_timetable_plan_semester_status ON timetable_plan (semester_id, status);

CREATE TABLE IF NOT EXISTS lesson (
  lesson_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  weekday        smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  period         smallint NOT NULL CHECK (period >= 1),
  week_parity    week_parity NOT NULL DEFAULT 'ALL',
  subject_id     uuid NOT NULL REFERENCES subject(subject_id),
  teacher_id     uuid NOT NULL REFERENCES teacher(teacher_id),
  venue_id       uuid NULL REFERENCES venue(venue_id),
  unit_type      scheduling_unit_type NOT NULL,
  unit_id        uuid NOT NULL,
  locked         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lesson_plan_weekday_period ON lesson (plan_id, weekday, period);
CREATE INDEX IF NOT EXISTS idx_lesson_plan_teacher ON lesson (plan_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_lesson_plan_venue ON lesson (plan_id, venue_id);
CREATE INDEX IF NOT EXISTS idx_lesson_unit ON lesson (unit_type, unit_id);

CREATE TABLE IF NOT EXISTS lesson_class (
  lesson_id  uuid NOT NULL REFERENCES lesson(lesson_id) ON DELETE CASCADE,
  class_id   uuid NOT NULL REFERENCES class(class_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_lesson_class_class ON lesson_class (class_id, lesson_id);

CREATE TABLE IF NOT EXISTS unscheduled_lesson (
  unscheduled_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  unit_type        scheduling_unit_type NOT NULL,
  unit_id          uuid NOT NULL,
  class_ids        uuid[] NOT NULL,
  subject_id       uuid NOT NULL REFERENCES subject(subject_id),
  teacher_id       uuid NOT NULL REFERENCES teacher(teacher_id),
  required_periods integer NOT NULL CHECK (required_periods >= 0),
  unplaced_periods integer NOT NULL CHECK (unplaced_periods >= 0),
  reason_code      unscheduled_reason NOT NULL,
  reason_detail    text NOT NULL,
  suggested_actions jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_unscheduled_actions_array CHECK (jsonb_typeof(suggested_actions) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_unscheduled_lesson_plan ON unscheduled_lesson (plan_id);
CREATE INDEX IF NOT EXISTS idx_unscheduled_unit ON unscheduled_lesson (unit_type, unit_id);

CREATE TABLE IF NOT EXISTS conflict_detail (
  conflict_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  lesson_id    uuid NULL REFERENCES lesson(lesson_id) ON DELETE SET NULL,
  conflict_type conflict_type NOT NULL,
  teacher_id   uuid NULL REFERENCES teacher(teacher_id),
  class_ids    uuid[] NULL,
  venue_id     uuid NULL REFERENCES venue(venue_id),
  weekday      smallint NULL CHECK (weekday BETWEEN 1 AND 7),
  period       smallint NULL CHECK (period >= 1),
  rule_id      text NULL,
  config_ref   jsonb NULL,
  suggestion   text NOT NULL,
  resolution   conflict_resolution NOT NULL DEFAULT 'UNRESOLVED',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conflict_detail_plan_resolution ON conflict_detail (plan_id, resolution);

CREATE TABLE IF NOT EXISTS conflict_ignore (
  ignore_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  conflict_id uuid NULL REFERENCES conflict_detail(conflict_id) ON DELETE SET NULL,
  operator_id uuid NOT NULL REFERENCES sys_user(user_id),
  reason      text NOT NULL,
  scope       text NOT NULL DEFAULT 'THIS_RUN' CHECK (scope = 'THIS_RUN'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conflict_ignore_plan ON conflict_ignore (plan_id);

CREATE TABLE IF NOT EXISTS adjustment_history (
  history_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES timetable_plan(plan_id) ON DELETE CASCADE,
  session_id  text NOT NULL,
  operator_id uuid NOT NULL REFERENCES sys_user(user_id),
  unit_id     uuid NOT NULL,
  operations  jsonb NOT NULL,
  action      adjustment_action NOT NULL CHECK (action IN ('APPLY', 'UNDO', 'REDO')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_adjustment_operations_array CHECK (jsonb_typeof(operations) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_adjustment_history_scope ON adjustment_history (plan_id, operator_id, session_id, created_at DESC);

-- =============================================================================
-- Governance / Identity support / Exchange（Phase 3）
-- =============================================================================
CREATE TABLE IF NOT EXISTS operation_log (
  log_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   uuid NOT NULL REFERENCES sys_user(user_id),
  operator_name text NOT NULL,
  module        operation_module NOT NULL,
  action        text NOT NULL,
  content       text NOT NULL,
  target_type   text NOT NULL,
  target_id     uuid NULL,
  request_id    text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operation_log_created ON operation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_log_operator_created ON operation_log (operator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_log_module_created ON operation_log (module, created_at DESC);

CREATE TABLE IF NOT EXISTS semester_archive (
  archive_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id uuid NOT NULL UNIQUE REFERENCES semester(semester_id),
  plan_id     uuid NOT NULL REFERENCES timetable_plan(plan_id),
  archived_by uuid NOT NULL REFERENCES sys_user(user_id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  summary     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_batch (
  batch_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module        import_module NOT NULL,
  filename      text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes >= 0),
  total         integer NOT NULL CHECK (total >= 0),
  success       integer NOT NULL CHECK (success >= 0),
  failed        integer NOT NULL CHECK (failed >= 0),
  status        import_batch_status NOT NULL,
  errors        jsonb NOT NULL DEFAULT '[]'::jsonb,
  operator_id   uuid NOT NULL REFERENCES sys_user(user_id),
  operator_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_import_batch_counts CHECK (total = success + failed),
  CONSTRAINT ck_import_batch_errors_array CHECK (jsonb_typeof(errors) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_import_batch_created ON import_batch (created_at DESC);

CREATE TABLE IF NOT EXISTS print_template (
  template_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  paper_size   print_paper_size NOT NULL DEFAULT 'A4',
  orientation  print_orientation NOT NULL DEFAULT 'LANDSCAPE',
  margin_mm    jsonb NOT NULL,
  title        text NULL,
  logo_data_uri text NULL,
  header_text  text NULL,
  footer_text  text NULL,
  is_preset    boolean NOT NULL DEFAULT false,
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL,
  CONSTRAINT ck_print_template_margin_object CHECK (jsonb_typeof(margin_mm) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_template_name_active ON print_template (lower(name)) WHERE deleted_at IS NULL;

-- =============================================================================
-- updated_at 触发器（仅可编辑表）
-- =============================================================================
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'teacher','venue','schedule_template','semester','calendar_exception','grade','subject','class',
    'subject_period_rule','combined_class','walking_group','teaching_assignment','timetable_plan',
    'lesson','print_template'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name, table_name);
  END LOOP;
END $$;

-- =============================================================================
-- 追加写保护：业务日志、冲突豁免、调课历史和安全审计禁止 UPDATE/DELETE
-- =============================================================================
CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['operation_log','conflict_ignore','adjustment_history','sys_audit_log']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_append_only ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation()', table_name, table_name);
  END LOOP;
END $$;

COMMENT ON TABLE teacher IS '教师主数据；employee_no 是登录账号的唯一来源';
COMMENT ON TABLE semester IS '学期；is_current 全校至多一个；存档后只读';
COMMENT ON TABLE timetable_plan IS '排课方案；同一学期至多一个 PUBLISHED';
COMMENT ON TABLE conflict_ignore IS 'D21 只本次忽略记录；不修改配置';
COMMENT ON TABLE semester_archive IS '学期存档快照索引；一个学期只允许存档一次';
COMMENT ON TABLE operation_log IS '七类关键操作日志；只追加，无更新/删除 API';
COMMENT ON TABLE import_batch IS '导入批次；errors 最多保存 1000 条明细';
COMMENT ON TABLE print_template IS '打印模板；预设模板不可删除';
