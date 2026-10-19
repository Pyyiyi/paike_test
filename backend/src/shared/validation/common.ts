import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/app-error';
import { parseSlotExpression } from '../time/slot-expression';

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
export const PERIOD_MIN = 1;
export const PERIOD_MAX = 20;

export const uuidSchema = z.string().uuid('必须是合法的 UUID');

export const paginationSchema = z.object({
  page: z.coerce.number().int('页码必须是整数').min(1, '页码从 1 开始').default(1),
  pageSize: z.coerce
    .number()
    .int('每页条数必须是整数')
    .min(1, '每页条数至少为 1')
    .max(PAGE_SIZE_MAX, `每页条数不能超过 ${PAGE_SIZE_MAX}`)
    .default(PAGE_SIZE_DEFAULT),
});

export const versionSchema = z.coerce.number().int('版本号必须是整数').min(1, '版本号必须大于 0');

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD')
  .refine(isRealDate, '日期不存在');

function isRealDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const weekdaySchema = z.coerce
  .number()
  .int('星期必须是整数')
  .min(1, '星期必须是 1-7')
  .max(7, '星期必须是 1-7');

export const periodSchema = z.coerce
  .number()
  .int('节次必须是整数')
  .min(PERIOD_MIN, `节次必须在 ${PERIOD_MIN}-${PERIOD_MAX}`)
  .max(PERIOD_MAX, `节次必须在 ${PERIOD_MIN}-${PERIOD_MAX}`);

export const weekParitySchema = z.enum(['ALL', 'ODD', 'EVEN'], {
  errorMap: () => ({ message: '周次奇偶必须是 ALL、ODD 或 EVEN' }),
});

export const slotSchema = z.object({
  weekday: weekdaySchema,
  period: periodSchema,
});

export const slotListSchema = z.array(slotSchema).min(1, '至少选择一个时段');

export const slotExpressionSchema = z
  .string()
  .trim()
  .min(1, '时段表达式不能为空')
  .transform((value, context) => {
    try {
      return parseSlotExpression(value);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : '时段表达式无效',
      });
      return z.NEVER;
    }
  })
  .pipe(slotListSchema);

export function parseBody<T>(schema: z.ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      next(
        new ValidationError(
          undefined,
          result.error.issues.map((issue) => ({
            field: issue.path.join('.') || undefined,
            message: issue.message,
          })),
          result.error,
        ),
      );
      return;
    }
    request.body = result.data;
    next();
  };
}

/** 模块模板使用的别名；行为与 parseBody 完全一致。 */
export const validateBody = parseBody;
