import type { LessonParity } from '../../shared/time/academic-week';

export type WorkloadUnitType = 'ASSIGNMENT' | 'COMBINED_CLASS' | 'WALKING_GROUP';
export type WorkloadCategory = 'regular' | 'consecutive' | 'combined';

export interface WorkloadLesson {
  lessonId: string;
  teacherId: string;
  subjectId: string;
  unitType: WorkloadUnitType;
  unitId: string;
  weekday: number;
  period: number;
  weekParity: LessonParity;
}

export interface PublishedWorkloadPlan {
  planId: string;
  lessons: WorkloadLesson[];
}

export interface WorkloadTotals {
  regular: number;
  consecutive: number;
  combined: number;
  overtime: number;
  total: number;
}

export interface TeacherWorkloadTotals extends WorkloadTotals {
  teacherId: string;
}
