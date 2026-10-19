import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(path.join(root, 'docs/knowledge/designs/0030_governance.sql'), 'utf8');
const design = readFileSync(path.join(root, 'docs/knowledge/designs/D07-governance-operations.md'), 'utf8');
const openapi = readFileSync(path.join(root, 'contracts/openapi.yaml'), 'utf8');
const schema = readFileSync(path.join(root, 'contracts/schema.sql'), 'utf8');
const events = readFileSync(path.join(root, 'contracts/events.yaml'), 'utf8');
const graph = readFileSync(path.join(root, 'docs/knowledge/dependency-graph.yaml'), 'utf8');
const roles = readFileSync(path.join(root, 'roles.md'), 'utf8');
const p3 = readFileSync(path.join(root, 'docs/knowledge/phase-contracts/p3-contracts.md'), 'utf8');
const crossContext = readFileSync(path.join(root, 'contracts/cross-context-writes.md'), 'utf8');

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe('D07 operation log, archive and semester switch design contract', () => {
  it('defines an append-only operation log with stable query indexes', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS operation_log');
    expect(migration).toContain('target_id     uuid NOT NULL');
    expect(migration).toContain('trg_operation_log_append_only');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON operation_log');
    expect(migration).toContain('idx_operation_log_created');
    expect(migration).toContain('created_at DESC, log_id DESC');
    expect(migration).toContain('idx_operation_log_operator_created');
    expect(migration).toContain('idx_operation_log_module_created');
    expect(migration).toContain('idx_operation_log_operator_module_created');
    expect(schema).toContain("ARRAY['operation_log','semester_archive','conflict_ignore','adjustment_history','sys_audit_log']");
    expect(design).toContain('无更新/删除 API，无自动清理或归档删除任务');
  });

  it('covers the seven F18 operations with complete Chinese audit fields', () => {
    for (const moduleName of ['DELETE','PUBLISH','OVERWRITE','SWITCH_SEMESTER','IMPORT','ARCHIVE','ADJUST']) {
      expect(design).toContain('`' + moduleName + '`');
    }
    expect(design).toContain('操作人、时间、模块、中文动作、中文内容、对象类型、对象 ID');
    expect(design).toContain('「发布 2026 秋季正式课表（方案 2026秋-v4）」');
    expect(design).toContain('「切换当前学期为「2027 春季」」');
    expect(design).toContain('「存档学期「2026 秋季」（方案 2026秋-v4）」');
    expect(design).toContain('不得保存错误码、英文枚举或 SQL');
    expect(migration).toContain('COMMENT ON COLUMN operation_log.action');
  });

  it('exposes only Admin list/detail APIs and documents filter ordering', () => {
    for (const operationId of ['listOperationLogs','getOperationLog','archiveSemester','getSemesterArchive','switchSemester','getArchiveStatus']) {
      expect(openapi).toContain(`operationId: ${operationId}`);
    }
    const list = between(openapi, '  /operation-logs:\n', '  /operation-logs/{logId}:\n');
    const detail = between(openapi, '  /operation-logs/{logId}:\n', '  /semesters/{id}/archive:\n');
    expect(list).toContain('x-required-roles:');
    expect(list).toContain('- ADMIN');
    expect(list).not.toMatch(/^\s+(put|delete):/m);
    expect(detail).toContain('- ADMIN');
    expect(detail).not.toMatch(/^\s+(put|delete):/m);
    expect(design).toContain('`from`：包含边界');
    expect(design).toContain('`to`：不包含边界');
    expect(design).toContain('ORDER BY created_at DESC, log_id DESC');
    expect(roles).toContain('LG-P-01');
  });

  it('requires PUBLISHED before archive and freezes the archive summary', () => {
    expect(design).toContain('「请先发布正式课表再存档」');
    expect(p3).toContain('「请先发布正式课表再存档」');
    expect(design).toContain('`timetable.PlanLifecycleService.archivePublished(tx, planId, actor)`');
    expect(design).toContain('`registry.SemesterLifecycleService.archive(tx, semesterId, actor, expectedVersion?)`');
    expect(design).toContain('`snapshotHash`');
    expect(migration).toContain('semester_id uuid NOT NULL UNIQUE');
    expect(migration).toContain('ck_semester_archive_summary_fields');
    expect(migration).toContain('trg_semester_archive_append_only');
    expect(openapi).toContain('SemesterArchiveSummary');
    expect(openapi).toContain('snapshotHash');
  });

  it('commits archive state, archive row, log and outbox in one transaction', () => {
    expect(design).toContain('学期存档、正式方案存档、`semester_archive`、日志与 outbox 必须同事务提交或全部回滚');
    expect(design).toContain('`bc.timetable.plan.archived');
    expect(design).toContain('`bc.registry.semester.status-changed');
    expect(design).toContain('任一服务、日志、摘要或 outbox 写入失败，全部回滚');
    expect(crossContext).toContain('学期、方案、存档、日志、outbox 同一事务');
    expect(p3).toContain('任一步失败全部回滚');
  });

  it('guards archived semesters as read-only while keeping reads and exports', () => {
    expect(design).toContain('已存档学期内以下写操作返回 `409 STATE_CONFLICT`');
    expect(design).toContain('「该学期已存档，只能查看或导出」');
    expect(design).toContain('Excel 导出、打印预览');
    expect(design).toContain('课表五视图、统计、空闲时段、日志列表/详情、存档详情');
    expect(design).toContain('其他未引用学期/模板删除不影响本记录');
  });

  it('defines DRAFT_EXISTS and SAVE/DISCARD/CANCEL semantics with zero-write cancel', () => {
    expect(openapi).toContain('DRAFT_EXISTS');
    expect(openapi).toContain('draftPlanId');
    expect(design).toContain('`409 DRAFT_EXISTS`');
    expect(design).toContain('「当前学期存在未发布草稿，请选择保存、放弃或取消」');
    expect(design).toContain('草稿原样保留；切换');
    expect(design).toContain('逻辑删除该草稿；切换');
    expect(design).toContain('CANCEL`：返回 200 与当前学期，不切 `is_current`、不删草稿、不写日志、不写 outbox');
    expect(design).toContain('目标学期为 `ARCHIVED` 时拒绝切换');
    expect(crossContext).toContain('不得创建/更新/删除日志、草稿或 outbox');
    expect(p3).toContain('返回 200 与当前学期；不切换、不删草稿、不写日志/outbox');
  });

  it('registers the current-semester event and governance topology', () => {
    expect(events).toContain('bc.registry.semester.current-changed');
    expect(events).toContain('previousSemesterId');
    expect(events).toContain('currentSemesterId');
    expect(graph).toContain('bc.registry.semester.current-changed');
    expect(graph).toContain('consumers: [timetable, governance]');
    expect(graph).toContain('PlanQueryService, PlanLifecycleService');
    expect(graph).toContain('SemesterQueryService, SemesterLifecycleService');
  });

  it('keeps multi-semester data isolated and records the archive test cases', () => {
    expect(design).toContain('跨学期查询必须显式带 `semesterId` 或目标 ID');
    expect(design).toContain('TC-AP-007');
    expect(design).toContain('TC-LG-001');
    expect(design).toContain('TC-LG-002');
    expect(design).toContain('TC-LG-003');
    expect(design).toContain('TC-LG-004');
    expect(design).toContain('TC-LG-005');
    expect(design).toContain('TC-CM-003');
    expect(design).toContain('O-LG-001-PERM');
  });
});
