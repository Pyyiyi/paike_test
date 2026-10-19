import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(
  path.join(root, 'docs/knowledge/designs/0014_resource_teacher_assignment.sql'),
  'utf8',
);
const openapi = readFileSync(path.join(root, 'contracts/openapi.yaml'), 'utf8');
const events = readFileSync(path.join(root, 'contracts/events.yaml'), 'utf8');
const design = readFileSync(
  path.join(root, 'docs/knowledge/designs/D03-teacher-assignment.md'),
  'utf8',
);

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe('D03 teacher and assignment design contract', () => {
  it('enforces T+digits and employee number uniqueness', () => {
    expect(migration).toContain("employee_no ~ '^T[0-9]+$'");
    expect(migration).toContain('CONSTRAINT uq_teacher_employee_no UNIQUE (employee_no)');
    expect(design).toContain('`A1001`、`1001`');
  });

  it('keeps forbidden and exempted slots independent', () => {
    const assignment = between(
      migration,
      'CREATE TABLE IF NOT EXISTS teaching_assignment (',
      'CREATE INDEX IF NOT EXISTS idx_assignment_teacher',
    );
    expect(assignment).toContain('forbidden_slots');
    expect(assignment).toContain('exempted_slots');
    expect(assignment).toContain("jsonb_typeof(forbidden_slots) = 'array'");
    expect(assignment).toContain("jsonb_typeof(exempted_slots) = 'array'");
    expect(assignment).not.toMatch(/merged_slots|combined_slots/);
  });

  it('does not impose a grade restriction on assignments', () => {
    const assignment = between(
      migration,
      'CREATE TABLE IF NOT EXISTS teaching_assignment (',
      'CREATE INDEX IF NOT EXISTS idx_assignment_teacher',
    );
    expect(assignment).not.toContain('grade_id');
    expect(design).toContain('跨年级任课必须成功');
  });

  it('defines positive weekly periods and one active assignment key', () => {
    expect(migration).toContain('weekly_periods >= 1');
    expect(migration).toContain('uq_assignment_active_teacher_class_subject');
    expect(migration).toContain('WHERE deleted_at IS NULL;');
  });

  it('defines distinct leave, restore, delete and reference-protection paths', () => {
    expect(openapi).toContain('operationId: deactivateTeacher');
    expect(openapi).toContain('operationId: restoreTeacher');
    expect(openapi).toContain("$ref: '#/components/schemas/TeacherRestoreRequest'");
    expect(design).toContain('`ACTIVE -> LEFT`');
    expect(design).toContain('`LEFT -> ACTIVE`');
    expect(design).toContain('`409 REFERENCE_PROTECTED`');
    expect(design).toContain('账号存在即视为引用并拒绝');
  });

  it('delegates idempotent account opening to D08', () => {
    expect(openapi).toContain('operationId: provisionTeacherAccount');
    expect(openapi).toContain('alreadyExists:');
    expect(design).toContain('alreadyExists=true');
    expect(design).toContain('不直接写 `sys_user`');
  });

  it('distinguishes assignment create, update and delete notifications', () => {
    const event = between(
      events,
      '- name: bc.resource.assignment.configured',
      '- name: bc.resource.venue.created',
    );
    expect(event).toContain('changeType');
    expect(event).toContain('CREATED');
    expect(event).toContain('UPDATED');
    expect(event).toContain('DELETED');
  });
});
