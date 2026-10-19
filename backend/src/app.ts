import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { registerModuleRouters } from './modules';
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
  routerLogger?: Pick<Console, 'info'>;
}

export async function createApp(options: AppOptions = {}): Promise<Express> {
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
  }

  app.use('/api/v1', createHealthRouter({ probe: options.probe }));
  await registerModuleRouters(app, {
    context: { auth: options.auth },
    logger: options.routerLogger,
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
