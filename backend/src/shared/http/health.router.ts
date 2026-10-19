import { Router } from 'express';
import { createAppError } from '../errors/app-error';
import { healthCheck } from '../db/pool';
import { fail, ok } from './envelope';

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
      fail(response, createAppError('DATABASE_UNAVAILABLE'));
      return;
    }

    ok(response, { status: 'ok', db: true });
  });

  return router;
}
