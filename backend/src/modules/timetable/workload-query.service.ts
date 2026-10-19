import type { Pool, QueryResultRow } from 'pg';
import { resolveWeekParity } from '../../shared/time/academic-week';
import { withTransactionOn } from '../../shared/db/transaction';
import type {
  PublishedWorkloadPlan,
  TeacherWorkloadTotals,
  WorkloadLesson,
  WorkloadTotals,
  WorkloadUnitType,
} from './workload.types';

interface PublishedPlanRow extends QueryResultRow {
  plan_id: string;
}

interface LessonRow extends QueryResultRow {
  lesson_id: string;
  teacher_id: string;
  subject_id: string;
  unit_type: WorkloadUnitType;
  unit_id: string;
  weekday: number;
  period: number;
  week_parity: WorkloadLesson['weekParity'];
}

function emptyTotals(): WorkloadTotals {
  return {
    regular: 0,
    consecutive: 0,
    combined: 0,
    overtime: 0,
    total: 0,
  };
}

function consecutiveGroupKey(lesson: WorkloadLesson): string {
  return [
    lesson.unitType,
    lesson.unitId,
    lesson.teacherId,
    lesson.subjectId,
    lesson.weekday,
  ].join(':');
}

function buildPeriodIndex(lessons: WorkloadLesson[]): Map<string, Set<number>> {
  const periods = new Map<string, Set<number>>();
  for (const lesson of lessons) {
    const key = consecutiveGroupKey(lesson);
    const group = periods.get(key) ?? new Set<number>();
    group.add(lesson.period);
    periods.set(key, group);
  }
  return periods;
}

function hasAdjacentPeriod(
  lesson: WorkloadLesson,
  periodsByGroup: Map<string, Set<number>>,
): boolean {
  const periods = periodsByGroup.get(consecutiveGroupKey(lesson));
  return Boolean(periods?.has(lesson.period - 1) || periods?.has(lesson.period + 1));
}

/**
 * Classify effective lesson occurrences. Each occurrence is counted once:
 * COMBINED_CLASS wins over consecutive, and consecutive wins over regular.
 */
export function summarizeWorkload(
  lessons: WorkloadLesson[],
  weeks: number[],
): TeacherWorkloadTotals[] {
  const totalsByTeacher = new Map<string, WorkloadTotals>();

  for (const weekIndex of weeks) {
    const effective = lessons.filter((lesson) => resolveWeekParity(weekIndex, lesson.weekParity));
    const periodsByGroup = buildPeriodIndex(effective);

    for (const lesson of effective) {
      const totals = totalsByTeacher.get(lesson.teacherId) ?? emptyTotals();
      if (lesson.unitType === 'COMBINED_CLASS') {
        totals.combined += 1;
      } else if (hasAdjacentPeriod(lesson, periodsByGroup)) {
        totals.consecutive += 1;
      } else {
        totals.regular += 1;
      }
      totals.total = totals.regular + totals.consecutive + totals.combined;
      totalsByTeacher.set(lesson.teacherId, totals);
    }
  }

  return [...totalsByTeacher.entries()].map(([teacherId, totals]) => ({
    teacherId,
    ...totals,
  }));
}

/** Read-only D05 boundary used by the statistics application module. */
export class WorkloadQueryService {
  constructor(private readonly pool: Pool) {}

  async getPublishedPlanLessons(semesterId: string): Promise<PublishedWorkloadPlan | null> {
    return withTransactionOn(
      this.pool,
      async (tx) => {
        const plan = await tx.queryOne<PublishedPlanRow>(
          `SELECT plan_id
             FROM timetable_plan
            WHERE semester_id = $1
              AND status = 'PUBLISHED'
              AND deleted_at IS NULL`,
          [semesterId],
        );
        if (!plan) {
          return null;
        }

        const rows = await tx.query<LessonRow>(
          `SELECT lesson_id, teacher_id, subject_id, unit_type, unit_id,
                  weekday, period, week_parity
             FROM lesson
            WHERE plan_id = $1
            ORDER BY teacher_id, weekday, period, unit_type, unit_id, lesson_id`,
          [plan.plan_id],
        );

        return {
          planId: plan.plan_id,
          lessons: rows.map((row) => ({
            lessonId: row.lesson_id,
            teacherId: row.teacher_id,
            subjectId: row.subject_id,
            unitType: row.unit_type,
            unitId: row.unit_id,
            weekday: row.weekday,
            period: row.period,
            weekParity: row.week_parity,
          })),
        };
      },
      { isolation: 'REPEATABLE READ' },
    );
  }
}
