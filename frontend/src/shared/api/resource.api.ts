import { http } from './http';
import type { PageData, SelectOption, Versioned } from './types';

export type VenueType = 'CLASSROOM' | 'FUNCTION_ROOM';
export type VenueStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface Slot {
  weekday: number;
  period: number;
}

export interface PeriodConstraint {
  slots: Slot[];
}

export interface Venue extends Versioned {
  venueId: string;
  name: string;
  type: VenueType;
  capacity: number;
  status: VenueStatus;
}

export interface CombinedClass extends Versioned {
  combinedClassId: string;
  name: string;
  teacherId: string;
  venueId: string;
  classIds: string[];
  periodConstraint: PeriodConstraint;
}

export interface WalkingGroup extends Versioned {
  walkingGroupId: string;
  name: string;
  subjectId: string;
  teacherId: string;
  venueId: string;
  classIds: string[];
}

export interface VenuePayload {
  name: string;
  type: VenueType;
  capacity: number;
  status?: VenueStatus;
}

export interface CombinedClassPayload {
  name: string;
  teacherId: string;
  venueId: string;
  classIds: string[];
  periodConstraint?: PeriodConstraint;
}

export interface WalkingGroupPayload {
  name: string;
  subjectId: string;
  teacherId: string;
  venueId: string;
  classIds: string[];
}

export interface ResourceOption {
  id?: string;
  teacherId?: string;
  classId?: string;
  subjectId?: string;
  name?: string;
  canonicalName?: string;
}

export interface ControlledVocabularyItem {
  vocabularyId: string;
  vocabType: string;
  canonicalName: string;
}

function list<T>(path: string, params?: Record<string, unknown>): Promise<PageData<T>> {
  return http.get<PageData<T>>(path, params);
}

export const resourceApi = {
  teachers: (params?: Record<string, unknown>) => list<ResourceOption>('/teachers', params),
  venues: (params?: Record<string, unknown>) => list<Venue>('/venues', params),
  combinedClasses: (params?: Record<string, unknown>) => list<CombinedClass>('/combined-classes', params),
  walkingGroups: (params?: Record<string, unknown>) => list<WalkingGroup>('/walking-groups', params),
  controlledVocabulary: (type: 'VENUE' | 'COMBINED_CLASS' | 'WALKING_GROUP') =>
    http.get<{ items: ControlledVocabularyItem[] }>('/controlled-vocabularies', { type }),

  createVenue: (body: VenuePayload) => http.post<Venue>('/venues', body),
  updateVenue: (venueId: string, body: VenuePayload & Versioned) =>
    http.patch<Venue>(`/venues/${venueId}`, body),
  deleteVenue: (venueId: string) => http.delete<void>(`/venues/${venueId}`),

  createCombinedClass: (body: CombinedClassPayload) =>
    http.post<CombinedClass>('/combined-classes', body),
  updateCombinedClass: (combinedClassId: string, body: CombinedClassPayload & Versioned) =>
    http.patch<CombinedClass>(`/combined-classes/${combinedClassId}`, body),
  deleteCombinedClass: (combinedClassId: string) =>
    http.delete<void>(`/combined-classes/${combinedClassId}`),

  createWalkingGroup: (body: WalkingGroupPayload) =>
    http.post<WalkingGroup>('/walking-groups', body),
  updateWalkingGroup: (walkingGroupId: string, body: WalkingGroupPayload & Versioned) =>
    http.patch<WalkingGroup>(`/walking-groups/${walkingGroupId}`, body),
  deleteWalkingGroup: (walkingGroupId: string) =>
    http.delete<void>(`/walking-groups/${walkingGroupId}`),
};

export function toOptions(items: ResourceOption[]): SelectOption[] {
  return items
    .map((item) => ({
      label: item.name ?? item.canonicalName ?? '',
      value: item.id ?? item.teacherId ?? item.classId ?? item.subjectId ?? '',
    }))
    .filter((item) => item.label && item.value);
}
