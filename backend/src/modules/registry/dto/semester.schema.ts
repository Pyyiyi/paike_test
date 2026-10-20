import { z } from 'zod';
import { dateSchema, versionSchema } from '../../../shared/validation/common';

const termSchema = z.enum(['FALL', 'SPRING'], {
  errorMap: () => ({ message: '学期类型必须是 FALL 或 SPRING' }),
});

const semesterNameSchema = z
  .string({ required_error: '请输入学期名称' })
  .trim()
  .min(1, '请输入学期名称')
  .max(100, '学期名称不能超过 100 个字符');

const academicYearSchema = z
  .string({ required_error: '请输入学年' })
  .trim()
  .regex(/^\d{4}-\d{4}$/, '学年格式必须为 YYYY-YYYY');

const scheduleTemplateVersionIdSchema = z
  .string({ required_error: '请选择作息模板' })
  .uuid('请选择作息模板');

function assertDatesOrder(
  value: { startDate?: string; endDate?: string },
  context: z.RefinementCtx,
): void {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: '结束日期不能早于开始日期',
    });
  }
}

export const createSemesterSchema = z
  .object({
    name: semesterNameSchema,
    academicYear: academicYearSchema,
    term: termSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    scheduleTemplateVersionId: scheduleTemplateVersionIdSchema,
  })
  .superRefine(assertDatesOrder);

export const updateSemesterSchema = z
  .object({
    name: semesterNameSchema.optional(),
    academicYear: academicYearSchema.optional(),
    term: termSchema.optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    scheduleTemplateVersionId: scheduleTemplateVersionIdSchema.optional(),
    version: versionSchema,
  })
  .superRefine(assertDatesOrder);

export type CreateSemesterInput = z.infer<typeof createSemesterSchema>;
export type UpdateSemesterInput = z.infer<typeof updateSemesterSchema>;
