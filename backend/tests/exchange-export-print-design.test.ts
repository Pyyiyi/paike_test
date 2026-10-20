import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const design = readFileSync(
  path.join(root, 'docs/knowledge/designs/D10-export-print.md'),
  'utf8',
);
const migration = readFileSync(
  path.join(root, 'docs/knowledge/designs/0033_exchange_print.sql'),
  'utf8',
);
const phaseContract = readFileSync(
  path.join(root, 'docs/knowledge/phase-contracts/p3-contracts.md'),
  'utf8',
);
const testResult = readFileSync(
  path.join(root, 'docs/trace/runs/v1/test-results/D10.md'),
  'utf8',
);
const schema = readFileSync(path.join(root, 'contracts/schema.sql'), 'utf8');
const openapi = readFileSync(path.join(root, 'contracts/openapi.yaml'), 'utf8');
const naming = readFileSync(path.join(root, 'contracts/naming.yaml'), 'utf8');
const events = readFileSync(path.join(root, 'contracts/events.yaml'), 'utf8');
const crossContext = readFileSync(path.join(root, 'contracts/cross-context-writes.md'), 'utf8');

describe('D10 export and print design contract', () => {
  it('defines one column dictionary for all three export dimensions', () => {
    for (const dimension of ['MASTER_DATA', 'TIMETABLE', 'STATISTICS']) {
      expect(design).toContain(dimension);
      expect(openapi).toContain(dimension);
    }
    for (const sheet of ['学期', '年级', '班级', '科目', '教师', '任课', '场地', '合班']) {
      expect(design).toContain(`| ${sheet} | 1 |`);
    }
    for (const column of [
      '对象类型',
      '对象名称',
      '星期',
      '节次',
      '开始时间',
      '结束时间',
      '科目',
      '教师',
      '班级',
      '场地',
      '单双周',
      '锁定',
    ]) {
      expect(design).toContain(`| ${column} |`);
    }
    for (const column of ['教师', '常规', '连堂', '合班', '加班', '合计', '统计口径', '教学周']) {
      expect(design).toContain(`| ${column} |`);
    }
    expect(design).toContain('页面和导出禁止各自维护列数组');
    expect(design).toContain('直接复用 D11 查询，不在 exchange 重算');
  });

  it('fixes XLSX value, formatting, filename, frozen-header and performance rules', () => {
    expect(design).toContain('{维度}_{学期}_{YYYYMMDDHHmm}.xlsx');
    expect(design).toContain('日期写 `YYYY-MM-DD` 字符串，时间写 `HH:mm` 字符串');
    expect(design).toContain('`null` 写为空单元格');
    expect(design).toContain("`topLeftCell='A2'`");
    expect(design).toContain("`state='frozen'`");
    expect(design).toContain('1000 行 × 12 列');
    expect(design).toContain('p95 ≤3000ms');
    expect(design).toContain('超过 10 分钟');
    expect(phaseContract).toContain('`COLUMN_DICTIONARY` 是列名、列序、Sheet 顺序');
    expect(phaseContract).toContain('不写公式/宏/外链/批注/远程图片');
  });

  it('synchronizes the print_template migration with schema constraints and presets', () => {
    for (const field of [
      'name',
      'paper_size',
      'orientation',
      'margin_mm',
      'title',
      'logo_data_uri',
      'header_text',
      'footer_text',
      'is_preset',
      'version',
      'deleted_at',
    ]) {
      expect(migration).toContain(field);
      expect(schema).toContain(field);
    }
    expect(migration).toContain("CREATE TYPE print_paper_size AS ENUM ('A4', 'A3')");
    expect(migration).toContain("CREATE TYPE print_orientation AS ENUM ('PORTRAIT', 'LANDSCAPE')");
    expect(migration).toContain('ck_print_template_margin_fits_page');
    expect(migration).toContain("logo_data_uri LIKE 'data:image/png;base64,%'");
    expect(migration).toContain('char_length(logo_data_uri) <= 2796226');
    expect(migration).toContain('forbid_preset_print_template_delete');
    expect(migration).toContain('trg_print_template_preset_soft_delete');
    expect(migration).toContain('trg_print_template_preset_hard_delete');
    for (const preset of ['标准课表 · 校徽版', '紧凑版（A4 横）', '教师手册版']) {
      expect(migration).toContain(preset);
      expect(design).toContain(preset);
    }
    expect(schema).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_print_template_name_active');
    expect(schema).toContain('forbid_preset_print_template_delete');
  });

  it('freezes template and upload validation in OpenAPI and naming', () => {
    expect(openapi).toContain('PrintMargins:');
    expect(openapi).toContain('maxLength: 2796226');
    expect(openapi).toContain("pattern: '^data:image/png;base64,'");
    expect(openapi).toContain('multipart/form-data');
    expect(openapi).toContain('maximum: 50');
    expect(openapi).toContain('PrintDimension:');
    expect(naming).toContain('print_dimension:');
    expect(naming).toContain('apiSchema: PrintDimension');
    expect(design).toContain('SVG/伪装 PNG 400');
    expect(design).toContain('返回 `413 FILE_TOO_LARGE`');
    expect(design).toContain('删除预设一律返回 `409 STATE_CONFLICT`');
  });

  it('defines a byte-identical PDF path with one token-protected HTML render', () => {
    expect(design).toContain('renderKey = sha256(templateId + templateVersion + snapshotHash + parity)');
    expect(design).toContain('相同 `renderKey` 返回同一份 PDF 字节');
    expect(design).toContain('不调用第二套打印引擎');
    expect(design).toContain('256-bit');
    expect(design).toContain('60 秒');
    expect(design).toContain('只保存 SHA-256');
    expect(design).toContain('过期、重复、篡改统一返回 `401 UNAUTHENTICATED`');
    expect(design).toContain("Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    expect(design).toContain('renderPdf');
    expect(openapi).toContain('/print/html/{token}:');
    expect(openapi).toContain('getProtectedPrintHtml');
    expect(openapi).toContain('ProtectedHtml');
    expect(phaseContract).toContain('`renderKey=sha256(templateId+version+snapshotHash+parity)`');
  });

  it('defines export/print audit and event contracts without second confirmation', () => {
    expect(design).toContain("action='EXPORT'");
    expect(design).toContain('不写 `operation_log`、不弹二次确认');
    expect(design).toContain("action=PRINT_PREVIEW|PRINT_RENDER");
    expect(design).toContain('`bc.exchange.export.completed`');
    expect(design).toContain('`bc.exchange.print.rendered`');
    expect(events).toContain('rowCount');
    expect(events).toContain('durationMs');
    expect(events).toContain('renderKey');
    expect(crossContext).toContain('一次性 256-bit token 60 秒');
    expect(crossContext).toContain('文件不落库');
  });

  it('exposes the dictionary and PDF timing contracts to clients', () => {
    for (const field of ['sheetKey', 'sheetName', 'valueType', 'format', 'nullable']) {
      expect(openapi).toContain(`${field}:`);
      expect(design).toContain(field);
    }
    for (const metric of [
      'browserLaunchMs',
      'htmlLoadMs',
      'pdfRenderMs',
      'totalDurationMs',
      'pdfBytes',
      'pageCount',
      'cacheHit',
    ]) {
      expect(design).toContain(metric);
    }
    expect(design).toContain('设计态不提供实测值');
  });

  it('keeps the D10 test-result record explicitly design-only', () => {
    expect(testResult).toContain('未执行');
    expect(testResult).toContain('TC-EX-001');
    expect(testResult).toContain('TC-EX-002');
    expect(testResult).toContain('TC-EX-003');
    expect(testResult).toContain('列字典单一来源');
    expect(testResult).toContain('同一 PDF');
    expect(testResult).toContain('禁止预先标记通过');
  });
});
