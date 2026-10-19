import { describe, expect, it, vi } from 'vitest';
import {
  WorkloadStatisticsService,
  type StatisticsSemesterQueries,
  type StatisticsWorkloadQueries,
} from '../src/modules/statistics/workload-statistics.service';
import { summarizeWorkload } from '../src/modules/timetable/workload-query.service';
import type { WorkloadLesson } from '../src/modules/timetable/workload.types';
import type { TeacherNameSource } from '../src/modules/resource/teacher-query.service';
import type { AcademicWeek } from '../src/modules/registry/semester/semester.query-service';
import type { SemesterDto } from '../src/modules/registry/semester/semester.mapper';

const TEACHER = '00000000-0000-4000-8000-000000000001';
const TEACHER_2 = '00000000-0000-4000-8000-000000000002';
const SUBJECT = '00000000-0000-4000-8000-000000000010';
const SEMESTER = '00000000-0000-4000-8000-000000000020';

function lesson(
  lessonId: string,
  overrides: Partial<WorkloadLesson> = {},
): WorkloadLesson {
  return {
    lessonId,
    teacherId: TEACHER,
    subjectId: SUBJECT,
    unitType: 'ASSIGNMENT',
    unitId: `unit-${lessonId}`,
    weekday: 1,
    period: 1,
    weekParity: 'ALL',
    ...overrides,
  };
}

function academicWeeks(count: number): AcademicWeek[] {
  return Array.from({ length: count }, (_, index) => ({
    weekIndex: index + 1,
    weekStart: `2026-09-${String(index * 7 + 1).padStart(2, '0')}`,
    weekEnd: `2026-09-${String(index * 7 + 7).padStart(2, '0')}`,
    parity: index % 2 === 0 ? 'ODD' : 'EVEN',
    stopped: false,
    stopExceptionIds: [],
    makeupWeekdays: [],
  }));
}

function semester(): SemesterDto {
  return {
    semesterId: SEMESTER,
    name: '2026 秋季学期',
    academicYear: '2026-2027',
    term: 'FALL',
    startDate: '2026-09-01',
    endDate: '2026-09-28',
    status: 'IN_PROGRESS',
    scheduleTemplateVersionId: '00000000-0000-4000-8000-000000000030',
    isCurrent: true,
    version: 1,
  } as SemesterDto;
}

function teacherNames(names: Record<string, string>): TeacherNameSource {
  return {
    getNames: vi.fn(async () => new Map(Object.entries(names))),
  };
}

function createService(
  workload: StatisticsWorkloadQueries,
  names: TeacherNameSource = teacherNames({ [TEACHER]: '张老师', [TEACHER_2]: '李老师' }),
): WorkloadStatisticsService {
  const semesterQueries: StatisticsSemesterQueries = {
    getSemester: async () => semester(),
    getAcademicCalendar: async () => academicWeeks(4),
  };
  return new WorkloadStatisticsService(semesterQueries, workload, names);
}

describe('D11 workload classification', () => {
  it('counts one combined lesson, a two-period consecutive block, and one regular lesson', () => {
    const totals = summarizeWorkload(
      [
        lesson('combined', { unitType: 'COMBINED_CLASS', period: 1 }),
        lesson('consecutive-1', { unitId: 'math-block', period: 2 }),
        lesson('consecutive-2', { unitId: 'math-block', period: 3 }),
        lesson('regular', { unitId: 'regular-unit', period: 5 }),
      ],
      [1],
    );

    expect(totals).toEqual([
      {
        teacherId: TEACHER,
        regular: 1,
        consecutive: 2,
        combined: 1,
        overtime: 0,
        total: 4,
      },
    ]);
  });

  it('never lets an adjacent combined block fall through to consecutive', () => {
    const totals = summarizeWorkload(
      [
        lesson('combined-1', { unitType: 'COMBINED_CLASS', unitId: 'combined-block', period: 1 }),
        lesson('combined-2', { unitType: 'COMBINED_CLASS', unitId: 'combined-block', period: 2 }),
      ],
      [1],
    );

    expect(totals[0]).toMatchObject({ combined: 2, consecutive: 0, regular: 0, total: 2 });
  });

  it('recomputes consecutive classification for each effective week parity', () => {
    const totals = summarizeWorkload(
      [
        lesson('all-week', { unitId: 'mixed-block', period: 1, weekParity: 'ALL' }),
        lesson('odd-week', { unitId: 'mixed-block', period: 2, weekParity: 'ODD' }),
      ],
      [1, 2, 3, 4],
    );

    expect(totals[0]).toMatchObject({ regular: 2, consecutive: 4, total: 6 });
  });

  it('uses ALL + matching parity for a week and all applicable weeks for a semester', () => {
    const lessons = [
      lesson('all', { unitId: 'all', period: 1 }),
      lesson('odd', { unitId: 'odd', period: 3, weekParity: 'ODD' }),
      lesson('even', { unitId: 'even', period: 5, weekParity: 'EVEN' }),
    ];

    const weekOne = summarizeWorkload(lessons, [1])[0];
    const weekTwo = summarizeWorkload(lessons, [2])[0];
    const semesterTotals = summarizeWorkload(lessons, [1, 2, 3, 4])[0];

    expect(weekOne).toMatchObject({ regular: 2, consecutive: 0, total: 2 });
    expect(weekTwo).toMatchObject({ regular: 2, consecutive: 0, total: 2 });
    expect(semesterTotals).toMatchObject({ regular: 8, consecutive: 0, total: 8 });
  });

  it('aggregates cross-grade lessons for the same teacher and keeps overtime at zero', async () => {
    const service = createService({
      getPublishedPlanLessons: async () => ({
        planId: '00000000-0000-4000-8000-000000000040',
        lessons: [
          lesson('grade-7', { unitId: 'grade-7', period: 1 }),
          lesson('grade-8', { unitId: 'grade-8', period: 3 }),
          lesson('grade-9', { unitId: 'grade-9', period: 4 }),
        ],
      }),
    });

    const result = await service.getWorkload({ semesterId: SEMESTER, scope: 'WEEK', weekIndex: 1 });

    expect(result.items).toEqual([
      {
        teacherId: TEACHER,
        teacherName: '张老师',
        regular: 3,
        consecutive: 0,
        combined: 0,
        overtime: 0,
        total: 3,
      },
    ]);
  });

  it('returns an empty result and the publish prompt when no PUBLISHED plan exists', async () => {
    const names = teacherNames({});
    const service = createService({ getPublishedPlanLessons: async () => null }, names);

    const result = await service.getWorkload({ semesterId: SEMESTER, scope: 'SEMESTER' });

    expect(result).toMatchObject({
      items: [],
      scope: 'SEMESTER',
      weekIndex: null,
      weekCount: 4,
      publishedPlanId: null,
      message: '请先发布课表',
    });
    expect(names.getNames).not.toHaveBeenCalled();
  });

  it('switching scope equals an independent recomputation of the selected range', async () => {
    const lessons = [
      lesson('all', { unitId: 'all', period: 1 }),
      lesson('odd', { unitId: 'odd', period: 3, weekParity: 'ODD' }),
      lesson('even', { unitId: 'even', period: 5, weekParity: 'EVEN' }),
    ];
    const service = createService({
      getPublishedPlanLessons: async () => ({
        planId: '00000000-0000-4000-8000-000000000040',
        lessons,
      }),
    });

    const week = await service.getWorkload({ semesterId: SEMESTER, scope: 'WEEK', weekIndex: 2 });
    const semesterResult = await service.getWorkload({ semesterId: SEMESTER, scope: 'SEMESTER' });

    expect(week.items[0]?.total).toBe(summarizeWorkload(lessons, [2])[0]?.total);
    expect(semesterResult.items[0]?.total).toBe(summarizeWorkload(lessons, [1, 2, 3, 4])[0]?.total);
  });
});
