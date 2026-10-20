import { z } from 'zod';
import { paginationSchema, periodSchema, uuidSchema, weekdaySchema } from '../../shared/validation/common';
import { normalizeControlledName } from './resource.naming';
import { EMPTY_PERIOD_CONSTRAINT, VENUE_STATUSES, VENUE_TYPES, type PeriodConstraint, type VenueStatus, type VenueType } from './resource.types';

const slotSchema = z.object({ weekday: weekdaySchema, period: periodSchema });

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : null;
}

function expandPeriodRange(start: unknown, end: unknown, weekday: unknown): Array<{ weekday: number; period: number }> {
  const weekdayValue = asInt(weekday);
  const startValue = asInt(start);
  const endValue = asInt(end);
  if (weekdayValue === null || startValue === null || endValue === null || endValue < startValue) {
    throw new Error('节次约束格式无效');
  }
  return Array.from({ length: endValue - startValue + 1 }, (_, index) => ({
    weekday: weekdayValue,
    period: startValue + index,
  }));
}

/** Accepts the UI/API shapes used before the contract normalized to { slots[] }. */
export function coercePeriodConstraint(value: unknown): PeriodConstraint {
  if (value === undefined || value === null) {
    return EMPTY_PERIOD_CONSTRAINT;
  }
  if (Array.isArray(value)) {
    return normalizeSlots(value);
  }
  if (typeof value !== 'object') {
    throw new Error('节次约束必须是对象');
  }

  const object = value as Record<string, unknown>;
  if (Array.isArray(object.slots)) {
    return normalizeSlots(object.slots);
  }
  if (object.slot !== undefined) {
    return normalizeSlots([object.slot]);
  }
  if (object.weekday !== undefined) {
    if (Array.isArray(object.periods)) {
      return normalizeSlots(object.periods.map((period) => ({ weekday: object.weekday, period })));
    }
    if (object.period !== undefined) {
      return normalizeSlots([{ weekday: object.weekday, period: object.period }]);
    }
    if (object.periodStart !== undefined || object.periodEnd !== undefined) {
      return normalizeSlots(
        expandPeriodRange(object.periodStart, object.periodEnd, object.weekday),
      );
    }
  }
  if (Array.isArray(object.weekdays)) {
    const slots: unknown[] = [];
    for (const weekday of object.weekdays) {
      if (Array.isArray(object.periods)) {
        slots.push(...object.periods.map((period) => ({ weekday, period })));
      } else if (object.periodStart !== undefined || object.periodEnd !== undefined) {
        slots.push(...expandPeriodRange(object.periodStart, object.periodEnd, weekday));
      }
    }
    return normalizeSlots(slots);
  }
  if (Object.keys(object).length === 0) {
    return EMPTY_PERIOD_CONSTRAINT;
  }
  throw new Error('节次约束格式无效');
}

function normalizeSlots(rawSlots: unknown[]): PeriodConstraint {
  if (rawSlots.length === 0) {
    return EMPTY_PERIOD_CONSTRAINT;
  }
  const seen = new Set<string>();
  const slots = rawSlots.map((raw) => {
    const parsed = slotSchema.parse(raw);
    const key = `${parsed.weekday}:${parsed.period}`;
    if (seen.has(key)) {
      throw new Error('节次约束存在重复时段');
    }
    seen.add(key);
    return parsed;
  });
  slots.sort((left, right) => left.weekday - right.weekday || left.period - right.period);
  return { slots };
}

const periodConstraintSchema = z.preprocess((value, context) => {
  try {
    return coercePeriodConstraint(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : '节次约束格式无效',
    });
    return z.NEVER;
  }
}, z.object({ slots: z.array(slotSchema) }));

const controlledNameSchema = z
  .string({ required_error: '名称不能为空' })
  .transform(normalizeControlledName)
  .pipe(
    z
      .string()
      .min(1, '名称不能为空')
      .max(80, '名称不能超过 80 个字符'),
  );

const classIdsSchema = z
  .array(uuidSchema, { required_error: '请选择参与班级' })
  .min(1, '请选择参与班级')
  .superRefine((classIds, context) => {
    const seen = new Set<string>();
    classIds.forEach((classId) => {
      if (seen.has(classId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: '参与班级不能重复',
        });
      }
      seen.add(classId);
    });
  });

const combinedClassIdsSchema = classIdsSchema.refine(
  (classIds) => classIds.length >= 2,
  '合班至少选择 2 个班级',
);

export const venueTypeSchema = z.enum(VENUE_TYPES, {
  errorMap: () => ({ message: '场地类型只能是 CLASSROOM 或 FUNCTION_ROOM' }),
});
export const venueStatusSchema = z.enum(VENUE_STATUSES, {
  errorMap: () => ({ message: '场地状态只能是 AVAILABLE 或 UNAVAILABLE' }),
});

export const createVenueSchema = z.object({
  name: controlledNameSchema,
  type: venueTypeSchema,
  capacity: z.number().int('容量必须是整数').min(1, '容量至少为 1'),
  status: venueStatusSchema.optional(),
});

export const updateVenueSchema = z
  .object({
    name: controlledNameSchema.optional(),
    type: venueTypeSchema.optional(),
    capacity: z.number().int('容量必须是整数').min(1, '容量至少为 1').optional(),
    status: venueStatusSchema.optional(),
    version: z.number().int('版本号必须是整数').min(1, '版本号必须大于 0'),
  })
  .refine(
    (value) => value.name !== undefined || value.type !== undefined || value.capacity !== undefined || value.status !== undefined,
    { message: '至少提供一个可修改字段' },
  );

export const venueListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(80).optional(),
  type: venueTypeSchema.optional(),
  status: venueStatusSchema.optional(),
});

export const createCombinedClassSchema = z.object({
  name: controlledNameSchema,
  teacherId: uuidSchema,
  venueId: uuidSchema,
  classIds: combinedClassIdsSchema,
  periodConstraint: periodConstraintSchema.optional(),
});

export const updateCombinedClassSchema = z
  .object({
    name: controlledNameSchema.optional(),
    teacherId: uuidSchema.optional(),
    venueId: uuidSchema.optional(),
    classIds: combinedClassIdsSchema.optional(),
    periodConstraint: periodConstraintSchema.optional(),
    version: z.number().int('版本号必须是整数').min(1, '版本号必须大于 0'),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.teacherId !== undefined ||
      value.venueId !== undefined ||
      value.classIds !== undefined ||
      value.periodConstraint !== undefined,
    { message: '至少提供一个可修改字段' },
  );

export const createWalkingGroupSchema = z.object({
  name: controlledNameSchema,
  subjectId: uuidSchema,
  teacherId: uuidSchema,
  venueId: uuidSchema,
  classIds: classIdsSchema,
});

export const updateWalkingGroupSchema = z
  .object({
    name: controlledNameSchema.optional(),
    subjectId: uuidSchema.optional(),
    teacherId: uuidSchema.optional(),
    venueId: uuidSchema.optional(),
    classIds: classIdsSchema.optional(),
    version: z.number().int('版本号必须是整数').min(1, '版本号必须大于 0'),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.subjectId !== undefined ||
      value.teacherId !== undefined ||
      value.venueId !== undefined ||
      value.classIds !== undefined,
    { message: '至少提供一个可修改字段' },
  );

export interface CreateVenueInput {
  name: string;
  type: VenueType;
  capacity: number;
  status?: VenueStatus;
}

export interface UpdateVenueInput {
  name?: string;
  type?: VenueType;
  capacity?: number;
  status?: VenueStatus;
  version: number;
}

export interface CreateCombinedClassInput {
  name: string;
  teacherId: string;
  venueId: string;
  classIds: string[];
  periodConstraint?: PeriodConstraint;
}

export interface UpdateCombinedClassInput {
  name?: string;
  teacherId?: string;
  venueId?: string;
  classIds?: string[];
  periodConstraint?: PeriodConstraint;
  version: number;
}

export interface CreateWalkingGroupInput {
  name: string;
  subjectId: string;
  teacherId: string;
  venueId: string;
  classIds: string[];
}

export interface UpdateWalkingGroupInput {
  name?: string;
  subjectId?: string;
  teacherId?: string;
  venueId?: string;
  classIds?: string[];
  version: number;
}
