import { http } from './http';
import type { PageData } from './types';

export type TimetableRow = Record<string, unknown>;

export interface TimetableQuery {
  semesterId: string;
  view: 'CLASS' | 'TEACHER' | 'SCHOOL' | 'VENUE' | 'ASSIGNMENT';
  objectId?: string;
}

export const timetableApi = {
  list: (query: TimetableQuery) => http.get<PageData<TimetableRow>>('/timetables', { ...query }),
  myTimetable: (query: Omit<TimetableQuery, 'view' | 'objectId'>) =>
    http.get<PageData<TimetableRow>>('/me/timetable', { ...query }),
  idleSlots: (query: Record<string, unknown>) => http.get<PageData<TimetableRow>>('/idle-slots', query),
  myIdleSlots: (query: Record<string, unknown>) => http.get<PageData<TimetableRow>>('/me/idle-slots', query),
  scheduling: (semesterId: string) => http.post<{ taskId: string }>('/scheduling', { semesterId }),
};
