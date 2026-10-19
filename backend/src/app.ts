import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { createAuthRouter } from './modules/auth/auth.router';
import { createResourceRouter } from './modules/resource/resource.router';
import { createCsrfMiddleware } from './shared/auth/csrf';
import { createForcedPasswordChangeGuard, createLoadCurrentUser } from './shared/auth/rbac';
import type { AuthRuntime } from './shared/auth/runtime';
import { createSessionMiddleware } from './shared/auth/session';
import { PgSessionStore } from './shared/auth/session-store';
import { errorHandler, notFoundHandler } from './shared/errors/error-handler';
import { createHealthRouter, type HealthRouterOptions } from './shared/http/health.router';
import { requestIdMiddleware } from './shared/http/request-id';

export interface AppOptions extends HealthRouterOptions {
  auth?: AuthRuntime;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  if (options.auth) {
    const store = new PgSessionStore({
      pool: options.auth.pool,
      config: options.auth.config,
      now: options.auth.now,
    });
    app.use(createSessionMiddleware(options.auth.config, store));
    app.use(createCsrfMiddleware());
    app.use(createLoadCurrentUser(options.auth));
    app.use(createForcedPasswordChangeGuard());
    app.use('/api/v1/auth', createAuthRouter(options.auth));
    app.use('/api/v1', createResourceRouter(options.auth.pool));
  }

  app.use('/api/v1', createHealthRouter({ probe: options.probe }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
