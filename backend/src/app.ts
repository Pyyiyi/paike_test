import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createHealthRouter, type HealthRouterOptions } from './shared/http/health.router';

export type AppOptions = HealthRouterOptions;

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', createHealthRouter({ probe: options.probe }));

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error(`请求处理失败：${message}`);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  });

  return app;
}
