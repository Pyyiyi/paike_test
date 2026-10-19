import { z } from 'zod';
import { ValidationError } from '../../shared/errors/app-error';
import { paginationSchema, uuidSchema } from '../../shared/validation/common';

const nameSchema = z
  .string({ required_error: '请选择名称', invalid_type_error: '名称必须是文本' })
  .trim()
  .min(1, '请选择名称')
  .max(50, '名称不能超过 50 个字符');

const sortOrderSchema = z
  .coerce.number({ invalid_type_error: '排序号必须是整数' })
  .int('排序号必须是整数')
  .min(0, '排序号不能小于 0')
  .max(9999, '排序号不能大于 9999');

export const serialNoSchema = z
  .coerce.number({ invalid_type_error: '须为 1-99 整数' })
  .int('须为 1-99 整数')
  .min(1, '须为 1-99 整数')
  .max(99, '须为 1-99 整数');

const studentCountSchema = z
  .coerce.number({ invalid_type_error: '学生人数必须是整数' })
  .int('学生人数必须是整数')
  .min(0, '学生人数不能小于 0')
  .max(9999, '学生人数不能大于 9999');

const slotSchema = z.object({
  weekday: z.coerce.number().int('星期必须是整数').min(1, '星期必须在 1-7').max(7, '星期必须在 1-7'),
  period: z.coerce.number().int('节次必须是整数').min(1, '节次必须在 1-20').max(20, '节次必须在 1-20'),
});

export const consecutivePreferenceSchema = z.enum(['NONE', 'PREFERRED', 'REQUIRED'], {
  errorMap: () => ({ message: '连堂偏好必须是 NONE、PREFERRED 或 REQUIRED' }),
});

export const timeSlotPreferenceSchema = z.enum(['NONE', 'MORNING', 'AFTERNOON'], {
  errorMap: () => ({ message: '时段优先必须是 NONE、MORNING 或 AFTERNOON' }),
});

export const GradeCreateSchema = z
  .object({
    name: nameSchema,
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();

export const GradeUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    version: z.coerce.number().int('版本号必须是整数').min(1, '版本号必须大于 0'),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.sortOrder !== undefined, {
    message: '至少需要修改一个字段',
  });

export const ClassCreateSchema = z
  .object({
    gradeId: uuidSchema,
    serialNo: serialNoSchema,
    headTeacherId: uuidSchema.nullable().optional(),
    studentCount: studentCountSchema,
  })
  .strict();

export const ClassUpdateSchema = z
  .object({
    serialNo: serialNoSchema.optional(),
    headTeacherId: uuidSchema.nullable().optional(),
    studentCount: studentCountSchema.optional(),
    version: z.coerce.number().int('版本号必须是整数').min(1, '版本号必须大于 0'),
  })
  .strict()
  .refine(
    (value) =>
      value.serialNo !== undefined ||
      value.headTeacherId !== undefined ||
      value.studentCount !== undefined,
    { message: '至少需要修改一个字段' },
  );

export const SubjectCreateSchema = z.object({ name: nameSchema }).strict();

export const SubjectUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    version: z.coerce.number().int('版本号必须是整数').min(1, '版本号必须大于 0'),
  })
  .strict()
  .refine((value) => value.name !== undefined, { message: '至少需要修改一个字段' });

export const SubjectPeriodRulePutSchema = z
  .object({
    weeklyPeriods: z.coerce
      .number({ invalid_type_error: '周课时必须是整数' })
      .int('周课时必须是整数')
      .min(0, '周课时不能小于 0')
      .max(99, '周课时不能大于 99'),
    consecutivePreference: consecutivePreferenceSchema.default('NONE'),
    forbiddenSlots: z.array(slotSchema).max(140, '禁排时段不能超过 140 个').default([]),
    timeSlotPreference: timeSlotPreferenceSchema.default('NONE'),
    periodBalanceEnabled: z.boolean().default(false),
    amPmBalanceEnabled: z.boolean().default(false),
    fixedSlotRuleEnabled: z.boolean().default(false),
    version: z.coerce.number().int('版本号必须是整数').min(0).optional(),
  })
  .strict();

export const VocabularyTypeSchema = z.enum(['SUBJECT', 'GRADE', 'VENUE'], {
  errorMap: () => ({ message: '受控词表类型必须是 SUBJECT、GRADE 或 VENUE' }),
});

export function parsePaginationQuery(query: unknown): { page: number; pageSize: number } {
  const parsed = paginationSchema.safeParse(query);
  if (!parsed.success) {
    throw new ValidationError(
      undefined,
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || undefined,
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function parseUuidParam(value: unknown, field = 'id'): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(undefined, [{ field, message: '必须是合法的 UUID' }]);
  }
  return parsed.data;
}

export function parseVocabularyType(value: unknown): 'SUBJECT' | 'GRADE' | 'VENUE' {
  const parsed = VocabularyTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(undefined, [
      { field: 'type', message: '受控词表类型必须是 SUBJECT、GRADE 或 VENUE' },
    ]);
  }
  return parsed.data;
}

export function dedupeSlots<T extends { weekday: number; period: number }>(slots: T[]): T[] {
  const seen = new Set<string>();
  return slots.filter((slot) => {
    const key = `${slot.weekday}:${slot.period}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
