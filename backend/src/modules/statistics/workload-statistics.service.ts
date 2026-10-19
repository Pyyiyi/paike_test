import type { Pool } from 'pg';
import type { Clock } from '../../shared/time/clock';
import { systemClock } from '../../shared/time/clock';
import { NotFoundError, ValidationError } from '../../shared/errors/app-error';
import {
  createSemesterQueryService,
  type AcademicWeek,
} from '../registry/semester/semester.query-service';
import type { SemesterDto } from '../registry/semester/semester.mapper';
import { TeacherQueryService, type TeacherNameSource } from '../resource/teacher-query.service';
import {
  WorkloadQueryService,
  summarizeWorkload,
} from '../timetable/workload-query.service';
import type { PublishedWorkloadPlan, WorkloadTotals } from '../timetable/workload.types';

export type WorkloadScope = 'WEEK' | 'SEMESTER';

export interface WorkloadRow extends WorkloadTotals {
  teacherId: string;
  teacherName: string;
}

export interface WorkloadStatisticsResult {
  items: WorkloadRow[];
  scope: WorkloadScope;
  weekIndex: number | null;
  weekCount: number;
  publishedPlanId: string | null;
  message: string | null;
}

export interface GetWorkloadInput {
  semesterId: string;
  scope: WorkloadScope;
  weekIndex?: number;
}

export interface StatisticsSemesterQueries {
  getSemester(semesterId: string): Promise<SemesterDto | null>;
  getAcademicCalendar(semesterId: string): Promise<AcademicWeek[]>;
}

export interface StatisticsWorkloadQueries {
  getPublishedPlanLessons(semesterId: string): Promise<PublishedWorkloadPlan | null>;
}

const NO_PUBLISHED_PLAN_MESSAGE = '请先发布课表';

export class WorkloadStatisticsService {
  constructor(
    private readonly semesterQueries: StatisticsSemesterQueries,
    private readonly workloadQueries: StatisticsWorkloadQueries,
    private readonly teacherQueries: TeacherNameSource,
  ) {}

  static fromPool(pool: Pool, clock: Clock = systemClock): WorkloadStatisticsService {
    return new WorkloadStatisticsService(
      createSemesterQueryService(pool, clock),
      new WorkloadQueryService(pool),
      new TeacherQueryService(pool),
    );
  }

  async getWorkload(input: GetWorkloadInput): Promise<WorkloadStatisticsResult> {
    const semester = await this.semesterQueries.getSemester(input.semesterId);
    if (!semester) {
      throw new NotFoundError('未找到该学期');
    }

    const calendar = await this.semesterQueries.getAcademicCalendar(input.semesterId);
    const weekCount = calendar.length;
    let weeks: number[];
    let selectedWeek: number | null = null;

    if (input.scope === 'WEEK') {
      if (input.weekIndex === undefined) {
        throw new ValidationError('保存失败，请检查输入内容', [
          { field: 'weekIndex', message: '周口径需选择教学周' },
        ]);
      }
      if (input.weekIndex < 1 || input.weekIndex > weekCount) {
        throw new ValidationError('保存失败，请检查输入内容', [
          { field: 'weekIndex', message: `教学周必须在 1-${weekCount} 之间` },
        ]);
      }
      weeks = [input.weekIndex];
      selectedWeek = input.weekIndex;
    } else {
      weeks = Array.from({ length: weekCount }, (_, index) => index + 1);
    }

    const published = await this.workloadQueries.getPublishedPlanLessons(input.semesterId);
    if (!published) {
      return {
        items: [],
        scope: input.scope,
        weekIndex: selectedWeek,
        weekCount,
        publishedPlanId: null,
        message: NO_PUBLISHED_PLAN_MESSAGE,
      };
    }

    const totals = summarizeWorkload(published.lessons, weeks);
    const names = await this.teacherQueries.getNames(totals.map((row) => row.teacherId));
    const items = totals
      .map((row) => ({
        ...row,
        teacherName: names.get(row.teacherId) ?? '未知教师',
      }))
      .sort(
        (left, right) =>
          left.teacherName.localeCompare(right.teacherName, 'zh-CN') ||
          left.teacherId.localeCompare(right.teacherId),
      );

    return {
      items,
      scope: input.scope,
      weekIndex: selectedWeek,
      weekCount,
      publishedPlanId: published.planId,
      message: null,
    };
  }
}
