export const VENUE_TYPES = ['CLASSROOM', 'FUNCTION_ROOM'] as const;
export type VenueType = (typeof VENUE_TYPES)[number];

export const VENUE_STATUSES = ['AVAILABLE', 'UNAVAILABLE'] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

export interface Slot {
  weekday: number;
  period: number;
}

export interface PeriodConstraint {
  slots: Slot[];
}

export interface Venue {
  venueId: string;
  name: string;
  type: VenueType;
  capacity: number;
  status: VenueStatus;
  version: number;
}

export interface CombinedClass {
  combinedClassId: string;
  name: string;
  teacherId: string;
  venueId: string;
  classIds: string[];
  periodConstraint: PeriodConstraint;
  version: number;
}

export interface WalkingGroup {
  walkingGroupId: string;
  name: string;
  subjectId: string;
  teacherId: string;
  venueId: string;
  classIds: string[];
  version: number;
}

export type SchedulingUnitType = 'COMBINED_CLASS' | 'WALKING_GROUP';

export interface SchedulingUnitSnapshot {
  unitId: string;
  unitType: SchedulingUnitType;
  name: string;
  subjectId: string | null;
  teacherId: string;
  venueId: string;
  classIds: string[];
  periodConstraint: PeriodConstraint;
}

export type ControlledResourceNameType = 'VENUE' | 'COMBINED_CLASS' | 'WALKING_GROUP';

export const EMPTY_PERIOD_CONSTRAINT: PeriodConstraint = { slots: [] };
