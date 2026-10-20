import type { Pool } from 'pg';
import type { Clock } from '../../shared/time/clock';

export type ConsecutivePreference = 'NONE' | 'PREFERRED' | 'REQUIRED';
export type TimeSlotPreference = 'NONE' | 'MORNING' | 'AFTERNOON';
export type VocabularyType = 'SUBJECT' | 'GRADE' | 'VENUE';

export interface Slot {
  weekday: number;
  period: number;
}

export interface GradeDto {
  gradeId: string;
  name: string;
  sortOrder: number;
  classCount: number;
  version: number;
}

export interface ClassDto {
  classId: string;
  gradeId: string;
  name: string;
  serialNo: number;
  headTeacherId: string | null;
  studentCount: number;
  version: number;
}

export interface SubjectPeriodRuleDto {
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

export interface SubjectDto {
  subjectId: string;
  name: string;
  periodRule: SubjectPeriodRuleDto | null;
  version: number;
}

export interface ControlledVocabularyDto {
  vocabId: string;
  type: string;
  name: string;
  synonyms: string[];
  isActive: boolean;
}

export interface RegistryContext {
  pool: Pool;
  clock?: Clock;
}

export interface ClassSnapshot {
  classId: string;
  gradeId: string;
  gradeName: string;
  name: string;
  serialNo: number;
  headTeacherId: string | null;
  studentCount: number;
}

export interface SubjectSnapshot {
  subjectId: string;
  name: string;
}

export interface SubjectPeriodRuleSnapshot {
  ruleId: string;
  subjectId: string;
  weeklyPeriods: number;
  consecutivePreference: ConsecutivePreference;
  forbiddenSlots: Slot[];
  timeSlotPreference: TimeSlotPreference;
  periodBalanceEnabled: boolean;
  amPmBalanceEnabled: boolean;
  fixedSlotRuleEnabled: boolean;
}

export interface ServiceActor {
  userId: string;
  username: string;
  displayName?: string;
}

export function actorName(actor: ServiceActor): string {
  return actor.displayName?.trim() || actor.username;
}
