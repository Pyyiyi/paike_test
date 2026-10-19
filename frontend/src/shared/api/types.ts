export type UserRole = 'ADMIN' | 'TEACHER';

export interface CurrentUser {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  teacherId: string | null;
  mustChangePassword: boolean;
}

export interface ErrorDetail {
  field?: string;
  message: string;
  rowNo?: number;
  column?: string;
  rawValue?: string;
}

export interface PageData<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Versioned {
  version: number;
}

export type SemesterStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'ENDED' | 'ARCHIVED';

export interface SemesterSummary extends Versioned {
  semesterId: string;
  name: string;
  status: SemesterStatus;
  startDate: string;
  endDate: string;
}

export interface SelectOption<T = string> {
  label: string;
  value: T;
}

export interface TimetableCell {
  lessonId: string;
  subjectName: string;
  teacherName?: string;
  className?: string;
  venueName?: string;
  weekParity?: 'ALL' | 'ODD' | 'EVEN';
  conflict?: boolean;
  conflictText?: string;
  locked?: boolean;
}

export interface TimetableGridCoord {
  weekday: number;
  period: number;
}
