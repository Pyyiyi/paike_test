import { http } from './http';

export type StatisticsRow = Record<string, unknown>;

export const statisticsApi = {
  workload: (semesterId: string) => http.get<StatisticsRow[]>('/statistics/workload', { semesterId }),
};
