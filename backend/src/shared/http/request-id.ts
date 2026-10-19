import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * 每个请求生成/透传 requestId，并写入响应头 X-Request-Id。
 * 客户端传入值只接受安全字符，避免响应头注入。
 */
export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const incoming = request.header('x-request-id');
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

  request.requestId = requestId;
  response.locals.requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  next();
}
