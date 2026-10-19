import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createAuthRouter } from './modules/auth/auth.router';
import { createCsrfMiddleware } from './shared/auth/csrf';
import { createForcedPasswordChangeGuard, createLoadCurrentUser } from './shared/auth/rbac';
import type { AuthRuntime } from './shared/auth/runtime';
import { createSessionMiddleware } from './shared/auth/session';
import { PgSessionStore } from './shared/auth/session-store';
import { isAppError } from './shared/errors/app-error';
import { createHealthRouter, type HealthRouterOptions } from './shared/http/health.router';

export interface AppOptions extends HealthRouterOptions {
  auth?: AuthRuntime;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  });

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
  }

  app.use('/api/v1', createHealthRouter({ probe: options.probe }));

  app.use((request: Request, response: Response) => {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: '接口不存在',
        ...(request.requestId ? { requestId: request.requestId } : {}),
      },
    });
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if (isAppError(error)) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          ...(request.requestId ? { requestId: request.requestId } : {}),
        },
      });
      return;
    }

    const message = error instanceof Error ? error.message : '未知错误';
    console.error(`请求处理失败：${message}`);
    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: '系统暂时不可用，请稍后重试',
        ...(request.requestId ? { requestId: request.requestId } : {}),
      },
    });
  });

  return app;
}
