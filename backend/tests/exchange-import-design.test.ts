import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const design = readFileSync(
  path.join(root, 'docs/knowledge/designs/D09-batch-import.md'),
  'utf8',
);
const migration = readFileSync(
  path.join(root, 'docs/knowledge/designs/0032_exchange_import.sql'),
  'utf8',
);
const schema = readFileSync(path.join(root, 'contracts/schema.sql'), 'utf8');
const openapi = readFileSync(path.join(root, 'contracts/openapi.yaml'), 'utf8');
const crossContext = readFileSync(path.join(root, 'contracts/cross-context-writes.md'), 'utf8');

describe('D09 batch import design contract', () => {
  it('defines all seven fixed modules and batch status/count invariants', () => {
    for (const module of [
      'SEMESTERS',
      'GRADES',
      'CLASSES',
      'SUBJECTS',
      'TEACHERS',
      'ASSIGNMENTS',
      'VENUES',
    ]) {
      expect(migration).toContain(`'${module}'`);
    }
    expect(migration).toContain("CREATE TYPE import_batch_status AS ENUM ('COMPLETED', 'PARTIAL', 'FAILED')");
    expect(migration).toContain('CHECK (total = success + failed)');
    expect(migration).toContain("status = 'COMPLETED' AND failed = 0 AND success = total");
    expect(migration).toContain("status = 'PARTIAL' AND success > 0 AND failed > 0");
    expect(migration).toContain("status = 'FAILED' AND success = 0");
  });

  it('defines the batch query/index and one-time error-report contract', () => {
    for (const index of [
      'idx_import_batch_created',
      'idx_import_batch_operator_created',
      'idx_import_batch_status_created',
      'idx_import_batch_module_created',
    ]) {
      expect(migration).toContain(index);
      expect(schema).toContain(index);
    }
    expect(migration).toContain('errors_truncated');
    expect(migration).toContain('error_report_url');
    expect(migration).toContain('error_report_downloaded_at');
    expect(design).toContain('UTF-8 BOM');
    expect(design).toContain('首次成功下载后再次下载返回 404');
    expect(design).toContain('行号,列名,原值,错误码,严重级别,中文原因');
  });

  it('fixes the seven template headers and natural keys', () => {
    for (const header of [
      '学期名称、学年、学期类型、开始日期、结束日期、作息模板名称、作息模板版本号',
      '年级名称、排序序号',
      '年级名称、班级序号、班级人数、班主任工号',
      '科目名称',
      '工号、姓名、性别、手机号',
      '教师工号、科目名称、班级名称、每周课时、连堂偏好、场地名称、禁排时段、免排时段',
      '场地名称、场地类型、容量、状态',
    ]) {
      expect(design).toContain(header);
    }
    for (const key of ['(学年, 学期类型)', '(年级名称, 班级序号)', '(教师工号, 班级名称, 科目名称)']) {
      expect(design).toContain(key);
    }
  });

  it('rejects file/header/encoding limits without a batch write', () => {
    expect(design).toContain('文件 >20 MB');
    expect(design).toContain('数据行 >5000');
    expect(design).toContain('缺少必填列');
    expect(design).toContain('未知列');
    expect(design).toContain('不使用 GBK 解析器');
    expect(design).toContain('文件级拒绝不创建 `import_batch`');
    expect(design).toContain('零写入、无批次');
  });

  it('keeps preview read-only and requires server-side confirmation', () => {
    expect(design).toContain('预览不写数据库、不写批次、不写日志、不写 outbox');
    expect(design).toContain('`confirm` 字段必须为 `true`');
    expect(openapi).toContain('multipart/form-data');
    expect(openapi).toContain('ImportPreviewRequest');
    expect(openapi).toContain('ImportExecuteRequest');
    expect(openapi).toContain('confirm:');
    expect(openapi).toContain('previewLimit:');
    expect(openapi).toContain('totalRows:');
  });

  it('defines row issue fields, codes and no-upsert behavior', () => {
    for (const field of ['rowNo:', 'column:', 'rawValue:', 'code:', 'severity:', 'message:']) {
      expect(openapi).toContain(field);
    }
    expect(openapi).toContain('ImportErrorCode');
    expect(openapi).toContain('REQUIRED_HEADER_MISSING');
    expect(openapi).toContain('DUPLICATE_KEY');
    expect(openapi).toContain('errorsTruncated:');
    expect(openapi).toContain('errorReportUrl');
    expect(design).toContain('不实现 upsert');
    expect(design).toContain('`DUPLICATE_KEY`');
    expect(design).toContain('原记录字段/版本不变');
  });

  it('uses one whole-batch transaction with FAILED compensation', () => {
    expect(crossContext).toContain('T4 导入批次事务');
    expect(crossContext).toContain('数据库/基础设施故障回滚全部合法行');
    expect(crossContext).toContain('补偿事务写 `FAILED` 批次');
    expect(design).toContain('合法行在单一数据库事务中提交');
    expect(design).toContain('独立补偿事务写入 `FAILED` 批次');
    expect(design).toContain('`success=0`、`failed=total`');
  });
});
