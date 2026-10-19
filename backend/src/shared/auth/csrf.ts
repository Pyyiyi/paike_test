import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { AuthConfig } from '../../config/auth';
import { AppError } from '../errors/app-error';

export const CSRF_COOKIE_NAME = 'csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(response: Response, config: AuthConfig): string {
  const token = randomBytes(32).toString('base64url');
  response.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: config.sessionIdleMs,
  });
  return token;
}

function tokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCsrfMiddleware(): RequestHandler {
  return (request, _response, next) => {
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      next();
      return;
    }

    const cookieToken = request.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = request.get(CSRF_HEADER_NAME);
    if (
      typeof cookieToken !== 'string' ||
      typeof headerToken !== 'string' ||
      !tokensEqual(cookieToken, headerToken)
    ) {
      next(new AppError(403, 'FORBIDDEN', '请求校验失败，请刷新页面后重试'));
      return;
    }

    next();
  };
}
