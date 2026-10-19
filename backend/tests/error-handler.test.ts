import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { errorHandler, normalizeError, notFoundHandler } from '../src/shared/errors/error-handler';
import { ValidationError } from '../src/shared/errors/app-error';
import { requestIdMiddleware } from '../src/shared/http/request-id';
import { z } from 'zod';

function throwingApp(): express.Express {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/boom', () => {
    throw new Error('password=super-secret phone=13812341234');
  });
  app.use(errorHandler);
  return app;
}

describe('error middleware', () => {
  it('maps an unknown exception to INTERNAL_ERROR with requestId and no stack leak', async () => {
    const response = await request(throwingApp()).get('/boom').set('x-request-id', 'req-test-123');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: '系统暂时不可用，请稍后重试',
        details: [],
        requestId: 'req-test-123',
      },
    });
    expect(response.headers['x-request-id']).toBe('req-test-123');
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('13812341234');
    expect(serialized).not.toContain('Error');
    expect(serialized).not.toContain('stack');
  });

  it('returns a consistent 404 envelope', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(notFoundHandler);

    const response = await request(app).get('/missing').set('x-request-id', 'req-404');
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: '接口不存在',
      details: [],
      requestId: 'req-404',
    });
  });

  it('maps a ZodError to VALIDATION_ERROR details', () => {
    const error = new z.ZodError([
      { code: 'custom', path: ['name'], message: '名称不能为空' },
    ]);
    const normalized = normalizeError(error);

    expect(normalized).toBeInstanceOf(ValidationError);
    expect(normalized.code).toBe('VALIDATION_ERROR');
    expect(normalized.details).toEqual([{ field: 'name', message: '名称不能为空' }]);
  });

  it('exposes the shared 404 handler through createApp', async () => {
    const response = await request(await createApp()).get('/api/v1/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
});
