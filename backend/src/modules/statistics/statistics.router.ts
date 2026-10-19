import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireAdmin } from '../../shared/auth/rbac';
import { ValidationError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/http/async-handler';
import { ok } from '../../shared/http/envelope';
import { uuidSchema } from '../../shared/validation/common';
import { systemClock, type Clock } from '../../shared/time/clock';
import type { ModuleRouterContext } from '../router-contract';
import {
  WorkloadStatisticsService,
  type WorkloadScope,
} from './workload-statistics.service';

const workloadQuerySchema = z
  .object({
    semesterId: uuidSchema,
    scope: z.enum(['SEMESTER', 'WEEK']),
    weekIndex: z.coerce.number().int('教学周必须是整数').min(1, '教学周从 1 开始').optional(),
  })
  .superRefine((value, context) => {
    if (value.scope === 'WEEK' && value.weekIndex === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekIndex'],
        message: '周口径需选择教学周',
      });
    }
  });

function parseWorkloadQuery(value: unknown): {
  semesterId: string;
  scope: WorkloadScope;
  weekIndex?: number;
} {
  const result = workloadQuerySchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      undefined,
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || undefined,
        message: issue.message,
      })),
      result.error,
    );
  }
  return result.data;
}

export function createRouter(context: ModuleRouterContext): Router | null {
  return context.auth?.pool ? createStatisticsRouter(context.auth.pool, context.clock ?? systemClock) : null;
}

export function createStatisticsRouter(
  pool: Pool,
  clock: Clock = systemClock,
  service: WorkloadStatisticsService = WorkloadStatisticsService.fromPool(pool, clock),
): Router {
  const router = Router();

  router.get(
    '/statistics/workload',
    requireAdmin,
    asyncHandler(async (request, response) => {
      const query = parseWorkloadQuery(request.query);
      ok(response, await service.getWorkload(query));
    }),
  );

  return router;
}
