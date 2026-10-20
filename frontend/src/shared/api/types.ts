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
export type Term = 'FALL' | 'SPRING';
export type TemplateStatus = 'ACTIVE' | 'RETIRED';
export type CalendarExceptionType = 'STOP' | 'MAKEUP';

export interface SemesterSummary extends Versioned {
  semesterId: string;
  name: string;
  academicYear: string;
  term: Term;
  status: SemesterStatus;
  startDate: string;
  endDate: string;
  scheduleTemplateVersionId: string;
  isCurrent: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Period {
  periodNo: number;
  startTime: string;
  endTime: string;
  label?: string | null;
}

export interface ScheduleTemplateVersion extends Versioned {
  versionId: string;
  templateId: string;
  versionNo: number;
  openWeekdays: number[];
  periods: Period[];
  status: TemplateStatus;
  createdAt: string;
}

export interface ScheduleTemplate extends Versioned {
  templateId: string;
  name: string;
  status: TemplateStatus;
  latestVersionNo: number;
  latestVersion?: ScheduleTemplateVersion;
}

export interface CalendarException extends Versioned {
  exceptionId: string;
  semesterId: string;
  type: CalendarExceptionType;
  startDate: string;
  endDate: string;
  makeupWeekday: number | null;
  note: string | null;
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
