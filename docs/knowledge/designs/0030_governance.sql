-- =============================================================================
-- D07 · 操作日志、学期存档与切换
-- 设计态交付：业务日志、查询索引、追加写保护、存档摘要与唯一约束。
-- 实施阶段按 0030_governance.sql 落入 migrations/。
-- 依赖：0010 registry.semester、0020 timetable_plan、0001 sys_user、D05 追加写函数。
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE operation_module AS ENUM (
    'DELETE', 'PUBLISH', 'OVERWRITE', 'SWITCH_SEMESTER', 'IMPORT', 'ARCHIVE', 'ADJUST',
    'GENERATE', 'SAVE_AS', 'IGNORE_ONCE', 'LOCK', 'UNLOCK'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS operation_log (
  log_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   uuid NOT NULL REFERENCES sys_user(user_id),
  operator_name text NOT NULL CHECK (btrim(operator_name) <> ''),
  module        operation_module NOT NULL,
  action        text NOT NULL CHECK (btrim(action) <> ''),
  content       text NOT NULL CHECK (btrim(content) <> ''),
  target_type   text NOT NULL CHECK (btrim(target_type) <> ''),
  target_id     uuid NOT NULL,
  request_id    text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 默认倒序、操作人、模块，以及操作人 + 模块组合筛选。
CREATE INDEX IF NOT EXISTS idx_operation_log_created
  ON operation_log (created_at DESC, log_id DESC);
CREATE INDEX IF NOT EXISTS idx_operation_log_operator_created
  ON operation_log (operator_id, created_at DESC, log_id DESC);
CREATE INDEX IF NOT EXISTS idx_operation_log_module_created
  ON operation_log (module, created_at DESC, log_id DESC);
CREATE INDEX IF NOT EXISTS idx_operation_log_operator_module_created
  ON operation_log (operator_id, module, created_at DESC, log_id DESC);

CREATE TABLE IF NOT EXISTS semester_archive (
  archive_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id uuid NOT NULL UNIQUE REFERENCES semester(semester_id),
  plan_id     uuid NOT NULL REFERENCES timetable_plan(plan_id),
  archived_by uuid NOT NULL REFERENCES sys_user(user_id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  summary     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_semester_archive_summary_object
    CHECK (jsonb_typeof(summary) = 'object'),
  CONSTRAINT ck_semester_archive_summary_fields
    CHECK (
      summary ? 'semesterName'
      AND summary ? 'academicYear'
      AND summary ? 'term'
      AND summary ? 'planName'
      AND summary ? 'planVersion'
      AND summary ? 'publishedAt'
      AND summary ? 'classCount'
      AND summary ? 'lessonCount'
      AND summary ? 'unscheduledCount'
      AND summary ? 'conflictCount'
      AND summary ? 'snapshotHash'
    )
);

CREATE INDEX IF NOT EXISTS idx_semester_archive_archived_at
  ON semester_archive (archived_at DESC, archive_id DESC);

CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_operation_log_append_only ON operation_log;
CREATE TRIGGER trg_operation_log_append_only
  BEFORE UPDATE OR DELETE ON operation_log
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_semester_archive_append_only ON semester_archive;
CREATE TRIGGER trg_semester_archive_append_only
  BEFORE UPDATE OR DELETE ON semester_archive
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

COMMENT ON TABLE operation_log IS '关键操作与显式审计动作；只追加，无更新/删除 API，无清理任务';
COMMENT ON COLUMN operation_log.operator_name IS '操作时姓名快照；账号改名或停用后仍可追溯';
COMMENT ON COLUMN operation_log.action IS '中文动作，如「发布」「保存调课」；不得写错误码或英文枚举';
COMMENT ON COLUMN operation_log.content IS '中文可读摘要，包含对象名称与必要数量；不得写错误码或英文枚举';
COMMENT ON COLUMN operation_log.target_id IS '业务对象 UUID；七类关键操作不得为空';
COMMENT ON TABLE semester_archive IS '学期存档摘要索引；一个学期只允许存档一次；存档后不可修改';
COMMENT ON COLUMN semester_archive.summary IS '冻结摘要；含 snapshotHash，用于证明存档后方案与课次未被修改';
