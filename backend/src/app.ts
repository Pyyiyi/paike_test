import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './shared/errors/error-handler';
import { createHealthRouter, type HealthRouterOptions } from './shared/http/health.router';
import { requestIdMiddleware } from './shared/http/request-id';

export type AppOptions = HealthRouterOptions;

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', createHealthRouter({ probe: options.probe }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
