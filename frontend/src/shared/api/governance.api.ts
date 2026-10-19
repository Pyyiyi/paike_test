import { http } from './http';
import type { PageData } from './types';

export type GovernanceRow = Record<string, unknown>;

export const governanceApi = {
  conflicts: (semesterId: string) => http.get<GovernanceRow[]>('/conflicts', { semesterId }),
  logs: (params?: Record<string, unknown>) => http.get<PageData<GovernanceRow>>('/logs', params),
  archiveSemester: (semesterId: string, version: number) =>
    http.post<{ ok: boolean }>('/archive', { semesterId, version }),
};
