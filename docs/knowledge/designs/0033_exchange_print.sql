-- =============================================================================
-- D10 · 打印模板与一次性打印访问支撑
-- 设计态交付：定义 print_template、字段约束、预设保护与查询索引。
-- 实施阶段必须按本序号落入 migrations/0033_exchange_print.sql，并由前序迁移补连续序号。
-- 依赖：sys_user（P0-01，仅审计使用，不在本迁移引用）。
-- 临时 HTML token 与 PDF 缓存只驻留进程且有 TTL，不落库；导出/打印文件不长期保存。
-- =============================================================================

DO $$
BEGIN
  CREATE TYPE print_paper_size AS ENUM ('A4', 'A3');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE print_orientation AS ENUM ('PORTRAIT', 'LANDSCAPE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS print_template (
  template_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  paper_size     print_paper_size NOT NULL DEFAULT 'A4',
  orientation    print_orientation NOT NULL DEFAULT 'LANDSCAPE',
  margin_mm      jsonb NOT NULL,
  title          text NULL,
  logo_data_uri  text NULL,
  header_text    text NULL,
  footer_text    text NULL,
  is_preset      boolean NOT NULL DEFAULT false,
  version        integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz NULL,
  CONSTRAINT ck_print_template_name_nonempty
    CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  CONSTRAINT ck_print_template_margin_object
    CHECK (jsonb_typeof(margin_mm) = 'object'),
  CONSTRAINT ck_print_template_margin_keys
    CHECK (
      margin_mm ? 'top' AND margin_mm ? 'right' AND margin_mm ? 'bottom' AND margin_mm ? 'left'
      AND (margin_mm - 'top' - 'right' - 'bottom' - 'left') = '{}'::jsonb
    ),
  CONSTRAINT ck_print_template_margin_numeric
    CHECK (
      jsonb_typeof(margin_mm->'top') = 'number'
      AND jsonb_typeof(margin_mm->'right') = 'number'
      AND jsonb_typeof(margin_mm->'bottom') = 'number'
      AND jsonb_typeof(margin_mm->'left') = 'number'
    ),
  CONSTRAINT ck_print_template_margin_range
    CHECK (
      (margin_mm->>'top')::numeric BETWEEN 0 AND 50
      AND (margin_mm->>'right')::numeric BETWEEN 0 AND 50
      AND (margin_mm->>'bottom')::numeric BETWEEN 0 AND 50
      AND (margin_mm->>'left')::numeric BETWEEN 0 AND 50
    ),
  CONSTRAINT ck_print_template_margin_fits_page
    CHECK (
      (margin_mm->>'left')::numeric + (margin_mm->>'right')::numeric
        <= CASE
             WHEN paper_size = 'A4' AND orientation = 'PORTRAIT' THEN 190
             WHEN paper_size = 'A4' AND orientation = 'LANDSCAPE' THEN 277
             WHEN paper_size = 'A3' AND orientation = 'PORTRAIT' THEN 277
             ELSE 400
           END
      AND (margin_mm->>'top')::numeric + (margin_mm->>'bottom')::numeric
        <= CASE
             WHEN paper_size = 'A4' AND orientation = 'PORTRAIT' THEN 277
             WHEN paper_size = 'A4' AND orientation = 'LANDSCAPE' THEN 190
             WHEN paper_size = 'A3' AND orientation = 'PORTRAIT' THEN 400
             ELSE 277
           END
    ),
  CONSTRAINT ck_print_template_logo_png
    CHECK (
      logo_data_uri IS NULL
      OR (
        logo_data_uri LIKE 'data:image/png;base64,%'
        AND char_length(logo_data_uri) <= 2796226
      )
    )
);

-- 逻辑删除后允许复用名称；同时保证未删除模板名称大小写不敏感唯一。
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_template_name_active
  ON print_template (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_print_template_preset
  ON print_template (is_preset DESC, created_at, template_id) WHERE deleted_at IS NULL;

-- 预设模板禁止逻辑删除或物理删除；应用层先返回 409，数据库触发器做最终兜底。
CREATE OR REPLACE FUNCTION forbid_preset_print_template_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_preset THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'preset print template cannot be deleted'
        USING ERRCODE = '23514';
    ELSIF NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'preset print template cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_print_template_preset_soft_delete ON print_template;
CREATE TRIGGER trg_print_template_preset_soft_delete
  BEFORE UPDATE OF deleted_at ON print_template
  FOR EACH ROW EXECUTE FUNCTION forbid_preset_print_template_delete();

DROP TRIGGER IF EXISTS trg_print_template_preset_hard_delete ON print_template;
CREATE TRIGGER trg_print_template_preset_hard_delete
  BEFORE DELETE ON print_template
  FOR EACH ROW EXECUTE FUNCTION forbid_preset_print_template_delete();

-- 三个预设模板由迁移幂等写入；logo 不内置，管理员可按 PNG 规则替换。
INSERT INTO print_template (
  name, paper_size, orientation, margin_mm, title, header_text, footer_text, is_preset
)
SELECT
  '标准课表 · 校徽版', 'A4', 'LANDSCAPE',
  '{"top":10,"right":10,"bottom":10,"left":10}'::jsonb,
  '课表', NULL, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM print_template
   WHERE lower(name) = lower('标准课表 · 校徽版') AND deleted_at IS NULL
);

INSERT INTO print_template (
  name, paper_size, orientation, margin_mm, title, header_text, footer_text, is_preset
)
SELECT
  '紧凑版（A4 横）', 'A4', 'LANDSCAPE',
  '{"top":6,"right":6,"bottom":6,"left":6}'::jsonb,
  '课表', NULL, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM print_template
   WHERE lower(name) = lower('紧凑版（A4 横）') AND deleted_at IS NULL
);

INSERT INTO print_template (
  name, paper_size, orientation, margin_mm, title, header_text, footer_text, is_preset
)
SELECT
  '教师手册版', 'A4', 'PORTRAIT',
  '{"top":12,"right":12,"bottom":12,"left":12}'::jsonb,
  '教师课表', NULL, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM print_template
   WHERE lower(name) = lower('教师手册版') AND deleted_at IS NULL
);

COMMENT ON TABLE print_template IS
  '打印模板；预设模板不可删除；模板编辑采用 version 乐观锁，逻辑删除后名称可复用';
COMMENT ON COLUMN print_template.margin_mm IS
  '毫米整数对象 {top,right,bottom,left}；每边 0..50，扣除边距后至少保留 20mm 可打印区域';
COMMENT ON COLUMN print_template.logo_data_uri IS
  '仅 PNG data URI；原始文件解码后 ≤2 MiB（2,097,152 bytes），禁止 SVG；实现层先验文件签名再入库';
COMMENT ON COLUMN print_template.version IS
  '创建为 0；每次编辑或更换校徽后 version+1，PATCH 必须携带当前 version';
