import { http } from './http';
import type { PageData, SemesterSummary } from './types';

export const semesterApi = {
  async list(): Promise<SemesterSummary[]> {
    const data = await http.get<SemesterSummary[] | PageData<SemesterSummary>>('/semesters');
    return Array.isArray(data) ? data : data.items;
  },
  async current(): Promise<SemesterSummary | null> {
    return http.get<SemesterSummary | null>('/semesters/current');
  },
};
