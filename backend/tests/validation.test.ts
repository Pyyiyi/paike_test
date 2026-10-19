import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../src/shared/errors/error-handler';
import { requestIdMiddleware } from '../src/shared/http/request-id';
import {
  dateSchema,
  paginationSchema,
  parseBody,
  slotExpressionSchema,
  uuidSchema,
  versionSchema,
  weekParitySchema,
  weekdaySchema,
  periodSchema,
} from '../src/shared/validation/common';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('common validation', () => {
  it('validates uuid, version, date, weekday and period', () => {
    expect(uuidSchema.safeParse(UUID).success).toBe(true);
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(versionSchema.parse('3')).toBe(3);
    expect(versionSchema.safeParse(0).success).toBe(false);
    expect(dateSchema.parse('2026-09-01')).toBe('2026-09-01');
    expect(dateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(weekdaySchema.parse('7')).toBe(7);
    expect(weekdaySchema.safeParse(8).success).toBe(false);
    expect(periodSchema.parse('20')).toBe(20);
    expect(periodSchema.safeParse(21).success).toBe(false);
    expect(weekParitySchema.parse('ALL')).toBe('ALL');
    expect(weekParitySchema.safeParse('SINGLE').success).toBe(false);
  });

  it('applies pagination defaults and limits', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.parse({ page: '2', pageSize: '50' })).toEqual({ page: 2, pageSize: 50 });
    expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it('parses slot expressions into validated slot lists', () => {
    expect(slotExpressionSchema.parse('周一第1-2节,周三第3节')).toEqual([
      { weekday: 1, period: 1 },
      { weekday: 1, period: 2 },
      { weekday: 3, period: 3 },
    ]);
    expect(slotExpressionSchema.safeParse('周一第0节').success).toBe(false);
  });

  it('parseBody replaces the body and returns a validation envelope on failure', async () => {
    const schema = z.object({ name: z.string({ required_error: '名称不能为空' }).min(1, '名称不能为空') });
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.post('/echo', parseBody(schema), (req, res) => {
      res.json({ data: req.body });
    });
    app.use(errorHandler);

    const success = await request(app).post('/echo').send({ name: 'x' });
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ data: { name: 'x' } });

    const failure = await request(app).post('/echo').send({});
    expect(failure.status).toBe(400);
    expect(failure.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'name', message: '名称不能为空' }],
    });
    expect(failure.body.error.requestId).toEqual(expect.any(String));
  });
});
