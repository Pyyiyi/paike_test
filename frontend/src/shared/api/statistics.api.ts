import { http } from './http';

export type WorkloadScope = 'SEMESTER' | 'WEEK';

export interface WorkloadRow {
  teacherId: string;
  teacherName: string;
  regular: number;
  consecutive: number;
  combined: number;
  overtime: number;
  total: number;
}

export interface WorkloadResult {
  items: WorkloadRow[];
  scope: WorkloadScope;
  weekIndex: number | null;
  weekCount: number;
  publishedPlanId: string | null;
  message: string | null;
}

export interface WorkloadQuery {
  semesterId: string;
  scope: WorkloadScope;
  weekIndex?: number;
}

export const statisticsApi = {
  workload: (query: WorkloadQuery) =>
    http.get<WorkloadResult>('/statistics/workload', {
      semesterId: query.semesterId,
      scope: query.scope,
      weekIndex: query.weekIndex,
    }),
};
