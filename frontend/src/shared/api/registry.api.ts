import { http } from './http';
import type { PageData } from './types';

export interface RegistryRow extends Record<string, unknown> {
  classId?: string;
  subjectId?: string;
  name?: string;
}

export interface Grade {
  gradeId: string;
  name: string;
  sortOrder: number;
  classCount: number;
  version: number;
}

export interface ClassItem extends RegistryRow {
  classId: string;
  gradeId: string;
  name: string;
  serialNo: number;
  headTeacherId: string | null;
  studentCount: number;
  version: number;
}

export type ConsecutivePreference = 'NONE' | 'PREFERRED' | 'REQUIRED';
export type TimeSlotPreference = 'NONE' | 'MORNING' | 'AFTERNOON';

export interface Slot {
  weekday: number;
  period: number;
}

export interface SubjectPeriodRule {
  ruleId: string;
  subjectId: string;
  weeklyPeriods: number;
  consecutivePreference: ConsecutivePreference;
  forbiddenSlots: Slot[];
  timeSlotPreference: TimeSlotPreference;
  periodBalanceEnabled: boolean;
  amPmBalanceEnabled: boolean;
  fixedSlotRuleEnabled: boolean;
  version: number;
}

export interface Subject extends RegistryRow {
  subjectId: string;
  name: string;
  periodRule: SubjectPeriodRule | null;
  version: number;
}

export interface ControlledVocabulary {
  vocabId: string;
  type: string;
  name: string;
  synonyms: string[];
  isActive: boolean;
}

export interface GradePayload {
  name: string;
  sortOrder?: number;
}

export interface ClassPayload {
  gradeId: string;
  serialNo: number;
  studentCount: number;
}

export interface ClassUpdatePayload {
  serialNo?: number;
  studentCount?: number;
  version: number;
}

export interface SubjectRulePayload {
  weeklyPeriods: number;
  consecutivePreference: ConsecutivePreference;
  forbiddenSlots: Slot[];
  timeSlotPreference: TimeSlotPreference;
  periodBalanceEnabled: boolean;
  amPmBalanceEnabled: boolean;
  fixedSlotRuleEnabled: boolean;
  version?: number;
}

function list<T>(path: string, params?: Record<string, unknown>): Promise<PageData<T>> {
  return http.get<PageData<T>>(path, params);
}

export const registryApi = {
  grades: (params?: Record<string, unknown>) => list<Grade>('/grades', params),
  createGrade: (body: GradePayload) => http.post<Grade>('/grades', body),
  updateGrade: (gradeId: string, body: GradePayload & { version: number }) =>
    http.patch<Grade>(`/grades/${gradeId}`, body),
  deleteGrade: (gradeId: string) => http.delete<void>(`/grades/${gradeId}`),

  classes: (params?: Record<string, unknown>) => list<ClassItem>('/classes', params),
  createClass: (body: ClassPayload) => http.post<ClassItem>('/classes', body),
  updateClass: (classId: string, body: ClassUpdatePayload) =>
    http.patch<ClassItem>(`/classes/${classId}`, body),
  deleteClass: (classId: string) => http.delete<void>(`/classes/${classId}`),

  subjects: (params?: Record<string, unknown>) => list<Subject>('/subjects', params),
  createSubject: (name: string) => http.post<Subject>('/subjects', { name }),
  updateSubject: (subjectId: string, name: string, version: number) =>
    http.patch<Subject>(`/subjects/${subjectId}`, { name, version }),
  deleteSubject: (subjectId: string) => http.delete<void>(`/subjects/${subjectId}`),
  saveSubjectRule: (subjectId: string, body: SubjectRulePayload) =>
    http.put<SubjectPeriodRule>(`/subjects/${subjectId}/period-rule`, body),

  controlledVocabularies: (type: 'SUBJECT' | 'GRADE' | 'VENUE') =>
    list<ControlledVocabulary>('/controlled-vocabularies', { type, pageSize: 100 }),
};
