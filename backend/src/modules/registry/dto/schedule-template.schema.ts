import { z } from 'zod';
import { uuidSchema } from '../../../shared/validation/common';

const timeSchema = z
  .string({ required_error: '请输入时间' })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式必须为 HH:mm（00:00-23:59）');

const periodSchema = z.object({
  periodNo: z.coerce
    .number({ required_error: '请输入节次编号' })
    .int('节次编号必须是整数')
    .min(1, '节次编号必须大于 0')
    .max(20, '节次编号不能超过 20'),
  startTime: timeSchema,
  endTime: timeSchema,
  label: z.string().trim().max(40, '节次名称不能超过 40 个字符').nullable().optional(),
});

const openWeekdaysSchema = z
  .array(
    z.coerce
      .number()
      .int('开放星期必须是整数')
      .min(1, '开放星期必须是 1-7')
      .max(7, '开放星期必须是 1-7'),
  )
  .min(1, '请至少选择一个开放星期');

const periodsSchema = z.array(periodSchema).min(1, '请至少配置一个节次');

export const createScheduleTemplateSchema = z.object({
  name: z
    .string({ required_error: '请输入模板名称' })
    .trim()
    .min(1, '请输入模板名称')
    .max(100, '模板名称不能超过 100 个字符'),
  openWeekdays: openWeekdaysSchema,
  periods: periodsSchema,
});

export const createScheduleTemplateVersionSchema = z.object({
  baseVersionId: uuidSchema.optional(),
  openWeekdays: openWeekdaysSchema,
  periods: periodsSchema,
});

export const calendarExceptionSchema = z
  .object({
    type: z.enum(['STOP', 'MAKEUP'], {
      errorMap: () => ({ message: '校历类型必须是 STOP 或 MAKEUP' }),
    }),
    startDate: z
      .string({ required_error: '请选择开始日期' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD'),
    endDate: z
      .string({ required_error: '请选择结束日期' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD'),
    makeupWeekday: z
      .union([z.coerce.number().int().min(1).max(7), z.null()])
      .optional(),
    note: z.string().trim().max(200, '备注不能超过 200 个字符').nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: '结束日期不能早于开始日期',
      });
    }
    if (value.type === 'MAKEUP' && (value.makeupWeekday === undefined || value.makeupWeekday === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['makeupWeekday'],
        message: '调休上课必须选择补课星期',
      });
    }
  });

export type CreateScheduleTemplateInput = z.infer<typeof createScheduleTemplateSchema>;
export type CreateScheduleTemplateVersionInput = z.infer<typeof createScheduleTemplateVersionSchema>;
export type CalendarExceptionInput = z.infer<typeof calendarExceptionSchema>;
