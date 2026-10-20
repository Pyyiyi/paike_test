import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const planSql = readFileSync(path.join(root, 'docs/knowledge/designs/0020_timetable_plan.sql'), 'utf8');
const lessonSql = readFileSync(
  path.join(root, 'docs/knowledge/designs/0021_timetable_lesson_conflict.sql'),
  'utf8',
);
const design = readFileSync(path.join(root, 'docs/knowledge/designs/D05-timetable-engine.md'), 'utf8');
const contract = readFileSync(path.join(root, 'docs/knowledge/phase-contracts/p2-contracts.md'), 'utf8');
const openapi = readFileSync(path.join(root, 'contracts/openapi.yaml'), 'utf8');
const schema = readFileSync(path.join(root, 'contracts/schema.sql'), 'utf8');
const config = readFileSync(path.join(root, 'docs/knowledge/config-contract.md'), 'utf8');
const d15 = JSON.parse(
  readFileSync(path.join(root, 'docs/knowledge/designs/D15-annex-a.fixture.json'), 'utf8'),
);

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe('D05 timetable engine design contract', () => {
  it('defines all seven D05 tables and the one-published invariant', () => {
    for (const table of [
      'timetable_plan',
      'lesson',
      'lesson_class',
      'unscheduled_lesson',
      'conflict_detail',
      'conflict_ignore',
      'adjustment_history',
    ]) {
      expect(`${planSql}\n${lessonSql}`).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(planSql).toContain('uq_plan_one_published');
    expect(planSql).toContain("WHERE status = 'PUBLISHED' AND deleted_at IS NULL");
    expect(planSql).toContain('generation_no');
    expect(planSql).toContain('generation_seed');
    expect(planSql).toContain('snapshot_hash');
  });

  it('preserves locks and records the run-scoped ignore audit without an FK cascade', () => {
    expect(lessonSql).toContain('ck_lesson_lock_trace');
    expect(lessonSql).toContain('locked_at');
    expect(lessonSql).toContain('locked_by');
    expect(lessonSql).toContain('generation_no');
    expect(lessonSql).toContain('conflict_fingerprint');
    expect(lessonSql).toContain('object_snapshot');
    expect(lessonSql).toContain("scope                 text NOT NULL DEFAULT 'THIS_RUN'");
    expect(lessonSql).not.toContain('conflict_id           uuid NULL REFERENCES conflict_detail');
    expect(design).toContain('故意不对 `conflict_id` 设外键');
    expect(design).toContain('下一次生成 `generation_no+1`');
  });

  it('specifies H1-H12, S1-S6 and D15 without expectation branches', () => {
    for (let i = 1; i <= 12; i += 1) expect(design).toContain(`| H${i} |`);
    for (let i = 1; i <= 6; i += 1) expect(design).toContain(`| ${i} |`);
    expect(design).toContain('MRV');
    expect(contract).toContain('单变量/单元回退最多 200 次');
    expect(design).toContain('200000');
    expect(design).toContain('4500ms');
    expect(design).toContain('代码中不得出现 D15 常量');
    expect(contract).toContain('不得写 D15 常量、对象 id 特例或期望表分支');
  });

  it('encodes all D15 cells and the 30-cell reconciliation', () => {
    expect(design).toContain('**6 列 × 5 行 = 30 个表格格**');
    expect(design).toContain('24 个 `(classId,weekday,period)` 数据坐标');
    expect(design).toContain('| 第 1 节 | 数学·张（连堂①） | 数学·李 | —（李免排） | — | — | 数学·李 |');
    expect(design).toContain('| 第 3 节 | 英语·李（301） | — | — | 英语·张（301） | —（禁排） | —（禁排） |');
    expect(design).toContain("cell('0105','math', '0109', null)");
    expect(design).toContain("cell('0105','english','010a','010b')");
    expect(design).toContain("cell('0106','english','0109','010b')");
    expect(d15.headerTitles).toHaveLength(6);
    expect(d15.rows).toHaveLength(4);
    const cells = d15.rows.flatMap((row: { cells: Record<string, unknown> }) => Object.values(row.cells));
    expect(cells).toHaveLength(24);
    expect(cells.filter((cell: unknown) => cell !== null)).toHaveLength(6);
    expect(cells.filter((cell: unknown) => cell === null)).toHaveLength(18);
    expect(cells.length + d15.headerTitles.length).toBe(30);
    expect(d15.rows[0].cells.monA).toEqual({ subjectId: d15.subjectIds.math, teacherId: d15.teacherIds.zhang, venueId: null });
    expect(d15.rows[2].cells.monA).toEqual({ subjectId: d15.subjectIds.english, teacherId: d15.teacherIds.li, venueId: d15.venueIds.room301 });
    expect(d15.rows[2].cells.tueB).toEqual({ subjectId: d15.subjectIds.english, teacherId: d15.teacherIds.zhang, venueId: d15.venueIds.room301 });
  });

  it('requires plan versions on write endpoints and overwrite confirmation', () => {
    expect(openapi).toContain('PlanVersionRequest');
    expect(openapi).toContain('confirmOverwrite');
    expect(openapi).toContain('GeneratePlanRequest');
    expect(openapi).toMatch(/GeneratePlanRequest:[\s\S]*?required:\n\s+- version\n\s+- preserveLocked/);
    const lock = between(openapi, '  /timetable-plans/{planId}/lessons/{lessonId}/lock:', '  /timetable-plans/{planId}/lessons/{lessonId}/unlock:');
    expect(lock).toContain("$ref: '#/components/schemas/PlanVersionRequest'");
    expect(openapi).toContain('name: version\n        in: query\n        required: true');
  });

  it('makes H10 executable and records D05 audit modules', () => {
    expect(schema).toContain('fixed_slots');
    expect(schema).toContain('ck_subject_period_rule_fixed_nonempty');
    expect(design).toContain('fixedSlots');
    expect(schema).toContain("'GENERATE', 'SAVE_AS', 'IGNORE_ONCE', 'LOCK', 'UNLOCK'");
    expect(openapi).toContain('- GENERATE');
    expect(config).toContain('SCHEDULER_MAX_BACKTRACK_PER_UNIT');
    expect(config).toContain('`200`');
    expect(config).toContain('`4500`');
  });

  it('documents reason mapping, non-ignorable conflicts and archived 409', () => {
    for (const reason of [
      'NO_FEASIBLE_SLOT',
      'TEACHER_EXHAUSTED',
      'CLASS_EXHAUSTED',
      'VENUE_EXHAUSTED',
      'CAPACITY',
      'LOCK_CONFLICT',
      'TIME_LIMIT',
    ]) {
      expect(design).toContain(reason);
    }
    expect(design).toContain('`CAPACITY_EXCEEDED`、`LOCKED_VIOLATION`、存档态不渲染忽略按钮');
    expect(design).toContain('已存档学期的生成、发布、覆盖、调课、锁定、忽略、另存和草稿变更全部返回 `409 STATE_CONFLICT`');
    expect(design).toContain('50 班/120 教师/15 科目/60 场地/1500 课次');
  });
});
