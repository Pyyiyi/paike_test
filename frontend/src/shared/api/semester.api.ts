import { http } from './http';
import type { CalendarException, PageData, SemesterSummary } from './types';

export interface SemesterWriteInput {
  name?: string;
  academicYear?: string;
  term?: 'FALL' | 'SPRING';
  startDate?: string;
  endDate?: string;
  scheduleTemplateVersionId?: string;
  version?: number;
}

export interface CalendarExceptionInput {
  type: 'STOP' | 'MAKEUP';
  startDate: string;
  endDate: string;
  makeupWeekday?: number | null;
  note?: string | null;
}

export const semesterApi = {
  async list(includeArchived = false): Promise<SemesterSummary[]> {
    const data = await http.get<SemesterSummary[] | PageData<SemesterSummary>>('/semesters', {
      includeArchived: includeArchived ? 'true' : undefined,
    });
    return Array.isArray(data) ? data : data.items;
  },
  current(): Promise<SemesterSummary> {
    return http.get<SemesterSummary>('/semesters/current');
  },
  create(input: SemesterWriteInput): Promise<SemesterSummary> {
    return http.post<SemesterSummary>('/semesters', input);
  },
  update(semesterId: string, input: SemesterWriteInput): Promise<SemesterSummary> {
    return http.patch<SemesterSummary>(`/semesters/${semesterId}`, input);
  },
  remove(semesterId: string, version?: number): Promise<void> {
    const suffix = version ? `?version=${version}` : '';
    return http.delete<void>(`/semesters/${semesterId}${suffix}`);
  },
  async listCalendarExceptions(semesterId: string): Promise<CalendarException[]> {
    const data = await http.get<CalendarException[] | PageData<CalendarException>>(
      `/semesters/${semesterId}/calendar-exceptions`,
    );
    return Array.isArray(data) ? data : data.items;
  },
  createCalendarException(
    semesterId: string,
    input: CalendarExceptionInput,
  ): Promise<CalendarException> {
    return http.post<CalendarException>(`/semesters/${semesterId}/calendar-exceptions`, input);
  },
  removeCalendarException(semesterId: string, exceptionId: string): Promise<void> {
    return http.delete<void>(`/semesters/${semesterId}/calendar-exceptions/${exceptionId}`);
  },
};
