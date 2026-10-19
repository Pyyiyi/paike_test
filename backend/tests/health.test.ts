import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

describe('GET /api/v1/health', () => {
  it('returns the exact success envelope', async () => {
    const response = await request(createApp({ probe: async () => true })).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: 'ok', db: true } });
  });

  it('returns a clear 503 when the database is unavailable', async () => {
    const response = await request(createApp({ probe: async () => false })).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: '数据库暂时不可用，请稍后重试',
      },
    });
  });

  it('does not expose probe errors or secrets', async () => {
    const response = await request(
      createApp({
        probe: async () => {
          throw new Error('password=super-secret cookie=session-token');
        },
      }),
    ).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(JSON.stringify(response.body)).not.toContain('session-token');
  });
});
