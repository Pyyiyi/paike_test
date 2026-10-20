import { describe, expect, it } from 'vitest';
import {
  createCombinedClassSchema,
  createVenueSchema,
  createWalkingGroupSchema,
  updateVenueSchema,
} from '../src/modules/resource/resource.validation';
import { normalizeControlledName } from '../src/modules/resource/resource.naming';

describe('resource validation', () => {
  it('normalizes controlled names without changing their display casing', () => {
    expect(normalizeControlledName('  Music   Room  ')).toBe('Music Room');
    expect(normalizeControlledName('\u3000实验室１\u3000')).toBe('实验室1');
  });

  it('accepts only the two venue types and enforces positive capacity', () => {
    expect(
      createVenueSchema.safeParse({ name: '301', type: 'CLASSROOM', capacity: 1 }).success,
    ).toBe(true);
    expect(
      createVenueSchema.safeParse({ name: '301', type: 'LAB', capacity: 1 }).success,
    ).toBe(false);
    expect(
      createVenueSchema.safeParse({ name: '301', type: 'CLASSROOM', capacity: 0 }).success,
    ).toBe(false);
    expect(updateVenueSchema.safeParse({ status: 'UNAVAILABLE', version: 1 }).success).toBe(true);
  });

  it('rejects duplicate combined and walking members', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const combined = createCombinedClassSchema.safeParse({
      name: '体育合班',
      teacherId: '00000000-0000-4000-8000-000000000002',
      venueId: '00000000-0000-4000-8000-000000000003',
      classIds: [id, id],
    });
    expect(combined.success).toBe(false);
    if (!combined.success) {
      expect(combined.error.issues[0]?.path.join('.')).toBe('classIds');
    }

    const walking = createWalkingGroupSchema.safeParse({
      name: '英语走班',
      subjectId: '00000000-0000-4000-8000-000000000004',
      teacherId: '00000000-0000-4000-8000-000000000002',
      venueId: '00000000-0000-4000-8000-000000000003',
      classIds: [id, id],
    });
    expect(walking.success).toBe(false);
    if (!walking.success) {
      expect(walking.error.issues[0]?.path.join('.')).toBe('classIds');
    }
  });

  it('normalizes supported period-constraint shapes and rejects invalid periods', () => {
    const base = {
      name: '体育合班',
      teacherId: '00000000-0000-4000-8000-000000000002',
      venueId: '00000000-0000-4000-8000-000000000003',
      classIds: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000005',
      ],
    };
    const parsed = createCombinedClassSchema.parse({
      ...base,
      periodConstraint: { weekday: 3, periodStart: 7, periodEnd: 8 },
    });
    expect(parsed.periodConstraint).toEqual({
      slots: [
        { weekday: 3, period: 7 },
        { weekday: 3, period: 8 },
      ],
    });
    expect(
      createCombinedClassSchema.safeParse({
        ...base,
        periodConstraint: { weekday: 8, period: 1 },
      }).success,
    ).toBe(false);
  });
});
