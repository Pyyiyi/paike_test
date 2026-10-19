import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const design = readFileSync(
  path.join(root, 'docs/knowledge/designs/D06-timetable-views-adjustments.md'),
  'utf8',
);
const indexSql = readFileSync(
  path.join(root, 'docs/knowledge/designs/0022_timetable_adjustment_indexes.sql'),
  'utf8',
);
const openapi = readFileSync(path.join(root, 'contracts/openapi.yaml'), 'utf8');
const schema = readFileSync(path.join(root, 'contracts/schema.sql'), 'utf8');
const contract = readFileSync(path.join(root, 'docs/knowledge/phase-contracts/p2-contracts.md'), 'utf8');
const results = readFileSync(path.join(root, 'docs/trace/runs/v1/test-results/D06.md'), 'utf8');

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

type Parity = 'ALL' | 'ODD' | 'EVEN';
type Slot = { weekday: number; period: number };
type Lesson = {
  lessonId: string;
  weekday: number;
  period: number;
  weekParity: Parity;
  subjectName: string;
  teacherId: string;
  classIds: string[];
  venueId: string | null;
  unitType: 'ASSIGNMENT' | 'COMBINED_CLASS' | 'WALKING_GROUP';
  unitId: string;
  locked: boolean;
};

const openSlots: Slot[] = [
  { weekday: 1, period: 1 },
  { weekday: 1, period: 2 },
  { weekday: 1, period: 3 },
  { weekday: 2, period: 1 },
  { weekday: 2, period: 2 },
  { weekday: 2, period: 3 },
  { weekday: 3, period: 1 },
  { weekday: 3, period: 2 },
  { weekday: 3, period: 3 },
];

const lessons: Lesson[] = [
  {
    lessonId: 'L1',
    weekday: 1,
    period: 1,
    weekParity: 'ALL',
    subjectName: '数学',
    teacherId: 'T1',
    classIds: ['701'],
    venueId: '301',
    unitType: 'ASSIGNMENT',
    unitId: 'A1',
    locked: false,
  },
  {
    lessonId: 'L2',
    weekday: 2,
    period: 2,
    weekParity: 'ODD',
    subjectName: '英语',
    teacherId: 'T2',
    classIds: ['701', '702'],
    venueId: '302',
    unitType: 'COMBINED_CLASS',
    unitId: 'C1',
    locked: false,
  },
  {
    lessonId: 'L3',
    weekday: 3,
    period: 3,
    weekParity: 'EVEN',
    subjectName: '物理',
    teacherId: 'T3',
    classIds: ['703'],
    venueId: null,
    unitType: 'ASSIGNMENT',
    unitId: 'A2',
    locked: true,
  },
];

function key(slot: Slot, parity: Parity): string {
  return `${slot.weekday}:${slot.period}:${parity}`;
}

function expandParity(parity: Parity): Parity[] {
  if (parity === 'ALL') return ['ODD', 'EVEN'];
  return [parity];
}

function expandOpen(parity: Parity): Set<string> {
  const cells = new Set<string>();
  for (const slot of openSlots) for (const p of expandParity(parity)) cells.add(key(slot, p));
  return cells;
}

function lessonCells(lesson: Lesson): Set<string> {
  const cells = new Set<string>();
  for (const p of expandParity(lesson.weekParity)) cells.add(key(lesson, p));
  return cells;
}

function occupiedForView(filtered: Lesson[], parity: Parity): Set<string> {
  const view = expandOpen(parity);
  const occupied = new Set<string>();
  for (const lesson of filtered) {
    for (const cell of lessonCells(lesson)) if (view.has(cell)) occupied.add(cell);
  }
  return occupied;
}

function complement(filtered: Lesson[], parity: Parity): Set<string> {
  const view = expandOpen(parity);
  const occupied = occupiedForView(filtered, parity);
  const idle = new Set<string>();
  for (const cell of view) if (!occupied.has(cell)) idle.add(cell);
  return idle;
}

function collapse(cells: Set<string>): { weekday: number; period: number; weekParity: Parity }[] {
  const bySlot = new Map<string, Set<Parity>>();
  for (const cell of cells) {
    const [weekday, period, parity] = cell.split(':');
    const slot = `${weekday}:${period}`;
    const set = bySlot.get(slot) ?? new Set<Parity>();
    set.add(parity as Parity);
    bySlot.set(slot, set);
  }
  return [...bySlot.entries()]
    .map(([slot, parities]) => {
      const parts = slot.split(':');
      const weekday = Number(parts[0]);
      const period = Number(parts[1]);
      const weekParity: Parity = parities.has('ODD') && parities.has('EVEN') ? 'ALL' : parities.has('ODD') ? 'ODD' : 'EVEN';
      return { weekday, period, weekParity };
    })
    .sort((a, b) => a.weekday - b.weekday || a.period - b.period);
}

function parityIntersects(left: Parity, right: Parity): boolean {
  if (left === 'ALL' || right === 'ALL') return true;
  return left === right;
}

type UndoUnit = { unitId: string; versionBefore: number; versionAfter: number };

function pushUndo(stack: UndoUnit[], unit: UndoUnit): UndoUnit[] {
  const next = [...stack, unit];
  return next.length > 50 ? next.slice(next.length - 50) : next;
}

function undo(stack: UndoUnit[], redo: UndoUnit[]): { stack: UndoUnit[]; redo: UndoUnit[] } {
  if (stack.length === 0) return { stack, redo };
  const unit = stack[stack.length - 1] as UndoUnit;
  return { stack: stack.slice(0, -1), redo: [...redo, unit] };
}

function redo(stack: UndoUnit[], redoStack: UndoUnit[]): { stack: UndoUnit[]; redo: UndoUnit[] } {
  if (redoStack.length === 0) return { stack, redo: redoStack };
  const unit = redoStack[redoStack.length - 1] as UndoUnit;
  return { stack: [...stack, unit], redo: redoStack.slice(0, -1) };
}

describe('D06 timetable view and adjustment design contract', () => {
  it('declares one five-view query service and one idle complement service', () => {
    expect(design).toContain('TimetableViewQueryService');
    expect(design).toContain('IdleSlotQueryService');
    for (const dimension of ['CLASS', 'TEACHER', 'SCHOOL', 'VENUE', 'ASSIGNMENT']) {
      expect(design).toContain(`\`${dimension}\``);
    }
    expect(design).toContain('班级 / 教师 / 全校 / 场地 / 任课');
    expect(design).toContain('`IdleSlotQueryService` 只复用其占用读取，不新增第二套课表查询');
    expect(design).toContain('禁止前端自行聚合');
  });

  it('adds only D06 indexes and mirrors them into the frozen schema', () => {
    expect(indexSql).toContain('0022_timetable_adjustment_indexes.sql');
    expect(indexSql).not.toMatch(/CREATE TABLE/i);
    expect(indexSql).not.toMatch(/ALTER TABLE/i);
    const indexes = [
      'idx_timetable_plan_semester_active',
      'idx_lesson_plan_parity_slot',
      'idx_lesson_plan_weekday_period_parity',
      'idx_lesson_plan_teacher_parity',
      'idx_lesson_plan_venue_parity',
      'idx_lesson_plan_unit_slot',
      'idx_lesson_plan_subject',
      'idx_adjustment_history_plan_created',
      'idx_adjustment_history_replay',
      'idx_adjustment_history_action',
      'uq_adjustment_history_apply_unit',
      'idx_operation_log_target_created',
    ];
    for (const index of indexes) {
      expect(indexSql).toContain(index);
      expect(schema).toContain(index);
    }
    expect(indexSql).toContain("WHERE action = 'APPLY'");
  });

  it('opens the view and idle endpoints to scoped teachers and requires save confirmation', () => {
    const timetable = between(openapi, '  /timetables:', '  /my/timetable:');
    expect(timetable).toContain('operationId: getTimetable');
    expect(timetable).toContain('- ADMIN');
    expect(timetable).toContain('- TEACHER');
    expect(timetable).toContain('name: planId');
    expect(timetable).toContain('name: unitType');

    const idle = between(openapi, '  /idle-slots:', '  /my/idle-slots:');
    expect(idle).toContain('operationId: getIdleSlots');
    expect(idle).toContain('- ADMIN');
    expect(idle).toContain('- TEACHER');
    expect(idle).toContain('name: planId');

    const adjustment = between(openapi, '    AdjustmentBatchRequest:', '    AdjustmentUndoRequest:');
    expect(adjustment).toContain('confirm');
    expect(adjustment).toMatch(/required:\n\s+- version\n\s+- unitId\n\s+- confirm\n\s+- operations/);
    expect(contract).toContain('"confirm": true');
    expect(contract).toContain('`confirm=true`');
  });

  it('keeps lesson identity and fields identical across the five dimensions', () => {
    const snapshots = new Map(lessons.map((lesson) => [lesson.lessonId, JSON.stringify(lesson)]));
    const view = (dimension: string, objectId: string | null): Lesson[] =>
      lessons.filter((lesson) => {
        if (dimension === 'CLASS') return objectId !== null && lesson.classIds.includes(objectId);
        if (dimension === 'TEACHER') return lesson.teacherId === objectId;
        if (dimension === 'SCHOOL') return true;
        if (dimension === 'VENUE') return lesson.venueId === objectId;
        if (dimension === 'ASSIGNMENT') return lesson.unitId === objectId;
        return false;
      });

    const class701 = view('CLASS', '701');
    const teacherT1 = view('TEACHER', 'T1');
    const school = view('SCHOOL', null);
    const venue301 = view('VENUE', '301');
    const assignmentA1 = view('ASSIGNMENT', 'A1');
    for (const lesson of [...class701, ...teacherT1, ...school, ...venue301, ...assignmentA1]) {
      expect(JSON.stringify(lesson)).toBe(snapshots.get(lesson.lessonId));
    }
    expect(class701.map((lesson) => lesson.lessonId)).toEqual(['L1', 'L2']);
    expect(teacherT1.map((lesson) => lesson.lessonId)).toEqual(['L1']);
    expect(school.map((lesson) => lesson.lessonId)).toEqual(['L1', 'L2', 'L3']);
    expect(venue301.map((lesson) => lesson.lessonId)).toEqual(['L1']);
    expect(assignmentA1.map((lesson) => lesson.lessonId)).toEqual(['L1']);

    const union = new Set<string>();
    for (const lesson of lessons) {
      if (lesson.classIds.length > 0) for (const classId of lesson.classIds) for (const item of view('CLASS', classId)) union.add(item.lessonId);
      for (const item of view('TEACHER', lesson.teacherId)) union.add(item.lessonId);
      for (const item of view('SCHOOL', null)) union.add(item.lessonId);
      if (lesson.venueId !== null) for (const item of view('VENUE', lesson.venueId)) union.add(item.lessonId);
      for (const item of view('ASSIGNMENT', lesson.unitId)) union.add(item.lessonId);
    }
    expect([...union].sort()).toEqual(['L1', 'L2', 'L3']);
  });

  it('proves idle is the strict complement of occupied for ALL/ODD/EVEN', () => {
    for (const parity of ['ALL', 'ODD', 'EVEN'] as Parity[]) {
      const open = expandOpen(parity);
      const occupied = occupiedForView(lessons, parity);
      const idle = complement(lessons, parity);
      expect([...occupied].filter((cell) => idle.has(cell))).toEqual([]);
      expect(new Set([...occupied, ...idle])).toEqual(open);
      expect(occupied.size + idle.size).toBe(open.size);
    }

    const allIdle = collapse(complement(lessons, 'ALL'));
    expect(allIdle).toHaveLength(8);
    expect(allIdle.filter((slot) => slot.weekParity === 'ALL')).toHaveLength(6);
    expect(allIdle.find((slot) => slot.weekday === 2 && slot.period === 2)?.weekParity).toBe('EVEN');
    expect(allIdle.find((slot) => slot.weekday === 3 && slot.period === 3)?.weekParity).toBe('ODD');

    expect(complement(lessons, 'ODD').size).toBe(7);
    expect(complement(lessons, 'EVEN').size).toBe(7);
    expect(collapse(complement(lessons, 'ODD')).every((slot) => slot.weekParity === 'ODD')).toBe(true);
    expect(collapse(complement(lessons, 'EVEN')).every((slot) => slot.weekParity === 'EVEN')).toBe(true);
  });

  it('encodes parity occupancy and locked/archived write guards', () => {
    expect(parityIntersects('ALL', 'ODD')).toBe(true);
    expect(parityIntersects('ALL', 'EVEN')).toBe(true);
    expect(parityIntersects('ODD', 'ODD')).toBe(true);
    expect(parityIntersects('EVEN', 'EVEN')).toBe(true);
    expect(parityIntersects('ODD', 'EVEN')).toBe(false);
    expect(design).toContain('`ALL` 同时占用 `ODD` 与 `EVEN`');
    expect(design).toContain('锁定课次移动一律 `409 STATE_CONFLICT`');
    expect(design).toContain('存档学期所有调课写请求一律 `409 STATE_CONFLICT`');
  });

  it('replays undo/redo in unit order and caps the client stack at 50', () => {
    let undoStack: UndoUnit[] = [];
    let redoStack: UndoUnit[] = [];
    const units: UndoUnit[] = [
      { unitId: 'U1', versionBefore: 10, versionAfter: 11 },
      { unitId: 'U2', versionBefore: 11, versionAfter: 12 },
      { unitId: 'U3', versionBefore: 12, versionAfter: 13 },
    ];
    for (const unit of units) undoStack = pushUndo(undoStack, unit);
    expect(undoStack.map((unit) => unit.unitId)).toEqual(['U1', 'U2', 'U3']);

    const undone: string[] = [];
    const redone: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      undone.push(undoStack.at(-1)!.unitId);
      ({ stack: undoStack, redo: redoStack } = undo(undoStack, redoStack));
    }
    expect(undone).toEqual(['U3', 'U2', 'U1']);
    expect(redoStack.map((unit) => unit.unitId)).toEqual(['U3', 'U2', 'U1']);

    for (let step = 0; step < 3; step += 1) {
      redone.push(redoStack.at(-1)!.unitId);
      ({ stack: undoStack, redo: redoStack } = redo(undoStack, redoStack));
    }
    expect(redone).toEqual(['U1', 'U2', 'U3']);
    expect(undoStack.map((unit) => unit.unitId)).toEqual(['U1', 'U2', 'U3']);

    for (let index = 0; index < 51; index += 1) {
      undoStack = pushUndo(undoStack, { unitId: `C${index}`, versionBefore: index, versionAfter: index + 1 });
    }
    expect(undoStack).toHaveLength(50);
    expect(undoStack[0]!.unitId).toBe('C1');
    expect(design).toContain('离开方案、刷新页面、切换方案或会话失效：清空两个栈');
    expect(design).toContain('栈上限 50');
  });

  it('specifies one atomic adjustment transaction with zero writes on any conflict', () => {
    const transaction = between(design, '`adjustments` 在一个事务内执行：', '`operation_log.content`');
    const validateAt = transaction.indexOf('构建临时占用叠加并校验教师/班级/场地冲突');
    const firstUpdateAt = transaction.indexOf('UPDATE lesson SET');
    expect(validateAt).toBeGreaterThanOrEqual(0);
    expect(firstUpdateAt).toBeGreaterThan(validateAt);
    expect(transaction).toContain('任一失败：ROLLBACK，返回 409/400，零写入');
    expect(transaction).toContain("INSERT adjustment_history(action='APPLY'");
    expect(transaction).toContain("INSERT operation_log(module='ADJUST'");
    expect(transaction).toContain("INSERT sys_outbox_event('bc.timetable.lesson.moved')");
    expect(design).toContain('`moves/validate` 不进入写事务');
    expect(design).toContain('任一调课操作冲突、锁定、存档或版本不匹配，整批零写入');
    expect(design).toContain('`confirm===true`');
  });

  it('enforces teacher scope, semester isolation, and the associated-class union', () => {
    expect(design).toContain('教师只能访问本人教师视图、本人关联班级视图和本人空闲');
    expect(design).toContain('`TEACHER` | 任意教师 | 仅 `objectId=actor.teacherId`');
    expect(design).toContain('`teaching_assignment.class_id` ∪ `class.head_teacher_id=teacher`');
    expect(design).toContain('所有查询强制 `semesterId`');
    expect(design).toContain('方案必须属于该学期');
    expect(design).toContain('`semesterId`');
    expect(design).toContain('403 FORBIDDEN');
    expect(design).toContain('`/my/classes`');
    expect(design).toContain('/my/idle-slots');
  });

  it('updates the D06 test-result record without claiming runtime execution', () => {
    expect(results).toContain('D06-timetable-views-adjustments.md');
    expect(results).toContain('0022_timetable_adjustment_indexes.sql');
    expect(results).toContain('五视图');
    expect(results).toContain('未执行');
    expect(results).not.toContain('执行状态 | 已通过');
  });
});
