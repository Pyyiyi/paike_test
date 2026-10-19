import { Router } from 'express';
import { healthCheck } from '../db/pool';

export interface HealthRouterOptions {
  probe?: () => Promise<boolean>;
}

export function createHealthRouter(options: HealthRouterOptions = {}): Router {
  const probe = options.probe ?? healthCheck;
  const router = Router();

  router.get('/health', async (_request, response) => {
    let databaseAvailable = false;
    try {
      databaseAvailable = await probe();
    } catch {
      databaseAvailable = false;
    }

    if (!databaseAvailable) {
      response.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: '数据库暂时不可用，请稍后重试',
        },
      });
      return;
    }

    response.json({ data: { status: 'ok', db: true } });
  });

  return router;
}
