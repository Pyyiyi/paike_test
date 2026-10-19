import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/shared/errors/app-error';
import { errorHandler } from '../src/shared/errors/error-handler';
import { created, fail, noContent, ok, paginated } from '../src/shared/http/envelope';
import { requestIdMiddleware } from '../src/shared/http/request-id';

function envelopeApp(): express.Express {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/ok', (_req, res) => ok(res, { value: 1 }));
  app.get('/created', (_req, res) => created(res, { value: 2 }));
  app.get('/empty', (_req, res) => noContent(res));
  app.get('/list', (_req, res) => paginated(res, [{ id: 1 }], 2, 20, 41));
  app.get('/fail', (_req, res) =>
    fail(res, new ValidationError(undefined, [{ field: 'name', message: '名称不能为空' }])),
  );
  app.use(errorHandler);
  return app;
}

describe('response envelope', () => {
  it('wraps success, created, no-content and paginated responses', async () => {
    const app = envelopeApp();

    const success = await request(app).get('/ok');
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ data: { value: 1 } });

    const createdResponse = await request(app).get('/created');
    expect(createdResponse.status).toBe(201);
    expect(createdResponse.body).toEqual({ data: { value: 2 } });

    const empty = await request(app).get('/empty');
    expect(empty.status).toBe(204);
    expect(empty.text).toBe('');

    const list = await request(app).get('/list');
    expect(list.body).toEqual({
      data: { items: [{ id: 1 }], page: 2, pageSize: 20, total: 41 },
    });
  });

  it('wraps failures with code, message, details and requestId', async () => {
    const response = await request(envelopeApp()).get('/fail').set('x-request-id', 'req-envelope');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: '保存失败，请检查输入内容',
        details: [{ field: 'name', message: '名称不能为空' }],
        requestId: 'req-envelope',
      },
    });
  });
});
