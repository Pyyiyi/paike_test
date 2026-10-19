-- =============================================================================
-- D09 · 批量导入批次表
-- 设计态交付：定义 import_batch、状态/计数约束、批次查询索引与一次性错误报告字段。
-- 实施阶段必须按本序号落入 migrations/0032_exchange_import.sql，并由前序迁移补连续序号。
-- 依赖：sys_user（P0-01）、operation_log（D07，仅运行时使用，不在本迁移建表）。
-- =============================================================================

DO $$
BEGIN
  CREATE TYPE import_module AS ENUM (
    'SEMESTERS', 'GRADES', 'CLASSES', 'SUBJECTS', 'TEACHERS', 'ASSIGNMENTS', 'VENUES'
  );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE import_batch_status AS ENUM ('COMPLETED', 'PARTIAL', 'FAILED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS import_batch (
  batch_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module                   import_module NOT NULL,
  filename                 text NOT NULL CHECK (btrim(filename) <> ''),
  size_bytes               integer NOT NULL CHECK (size_bytes >= 0),
  total                    integer NOT NULL CHECK (total >= 0),
  success                  integer NOT NULL CHECK (success >= 0),
  failed                   integer NOT NULL CHECK (failed >= 0),
  status                   import_batch_status NOT NULL,
  errors                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors_truncated         boolean NOT NULL DEFAULT false,
  error_report_url         text NULL,
  error_report_downloaded_at timestamptz NULL,
  operator_id              uuid NOT NULL REFERENCES sys_user(user_id),
  operator_name            text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_import_batch_counts CHECK (total = success + failed),
  CONSTRAINT ck_import_batch_errors_array CHECK (jsonb_typeof(errors) = 'array'),
  CONSTRAINT ck_import_batch_errors_limit CHECK (jsonb_array_length(errors) <= 1000),
  CONSTRAINT ck_import_batch_status_counts CHECK (
    (status = 'COMPLETED' AND failed = 0 AND success = total)
    OR (status = 'PARTIAL' AND success > 0 AND failed > 0)
    OR (status = 'FAILED' AND success = 0)
  ),
  CONSTRAINT ck_import_batch_report_pair CHECK (
    (error_report_url IS NULL AND error_report_downloaded_at IS NULL)
    OR (error_report_url IS NOT NULL)
  )
);

-- 批次详情按 PK 读取；以下索引覆盖管理端按时间、操作人、状态、模块筛选。
CREATE INDEX IF NOT EXISTS idx_import_batch_created
  ON import_batch (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batch_operator_created
  ON import_batch (operator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batch_status_created
  ON import_batch (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batch_module_created
  ON import_batch (module, created_at DESC);

COMMENT ON TABLE import_batch IS
  '导入批次；errors 同时保存 ERROR 与 WARNING，最多 1000 条，failed 只统计行级 ERROR 对应的去重数据行';
COMMENT ON COLUMN import_batch.total IS '数据行数，不含表头与空行';
COMMENT ON COLUMN import_batch.errors IS 'ImportIssue[]：rowNo/column/rawValue/code/severity/message；超过 1000 条时 errorsTruncated=true';
COMMENT ON COLUMN import_batch.error_report_url IS '有 issue 时保存相对 URL；绝不保存 CSV 文件本体';
COMMENT ON COLUMN import_batch.error_report_downloaded_at IS '首次成功下载后写入；非空后再次下载返回 404，保证一次性';
COMMENT ON COLUMN import_batch.status IS
  'COMPLETED=全部行成功；PARTIAL=至少一行成功且有失败行；FAILED=零成功（全部非法或数据库/基础设施故障）';
