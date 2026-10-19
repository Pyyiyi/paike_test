import express from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createStatisticsRouter } from '../src/modules/statistics/statistics.router';
import type { WorkloadStatisticsService } from '../src/modules/statistics/workload-statistics.service';
import { errorHandler } from '../src/shared/errors/error-handler';
import { requestIdMiddleware } from '../src/shared/http/request-id';

function createApp(service: WorkloadStatisticsService) {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = {
      userId: '00000000-0000-4000-8000-000000000099',
      username: 'statistics-admin',
      displayName: '统计管理员',
      role: 'ADMIN',
      teacherId: null,
      mustChangePassword: false,
    };
    next();
  });
  app.use('/api/v1', createStatisticsRouter({} as Pool, undefined, service));
  app.use(errorHandler);
  return app;
}

describe('statistics workload route', () => {
  it('returns the workload envelope for a valid request', async () => {
    const service = {
      getWorkload: vi.fn(async () => ({
        items: [],
        scope: 'SEMESTER' as const,
        weekIndex: null,
        weekCount: 18,
        publishedPlanId: null,
        message: '请先发布课表',
      })),
    } as unknown as WorkloadStatisticsService;

    const response = await request(createApp(service))
      .get('/api/v1/statistics/workload')
      .query({ semesterId: '00000000-0000-4000-8000-000000000020', scope: 'SEMESTER' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      items: [],
      scope: 'SEMESTER',
      weekCount: 18,
      message: '请先发布课表',
    });
    expect(service.getWorkload).toHaveBeenCalledWith({
      semesterId: '00000000-0000-4000-8000-000000000020',
      scope: 'SEMESTER',
    });
  });

  it('requires weekIndex for WEEK scope', async () => {
    const service = { getWorkload: vi.fn() } as unknown as WorkloadStatisticsService;

    const response = await request(createApp(service))
      .get('/api/v1/statistics/workload')
      .query({ semesterId: '00000000-0000-4000-8000-000000000020', scope: 'WEEK' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toContainEqual({
      field: 'weekIndex',
      message: '周口径需选择教学周',
    });
    expect(service.getWorkload).not.toHaveBeenCalled();
  });
});
