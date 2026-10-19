import session from 'express-session';
import type { Request, RequestHandler } from 'express';
import type { AuthConfig } from '../../config/auth';
import type { PgSessionStore } from './session-store';

export function createSessionMiddleware(config: AuthConfig, store: PgSessionStore): RequestHandler {
  return session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: config.sessionIdleMs,
      path: '/',
    },
  });
}

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

export async function createSession(request: Request, userId: string, config: AuthConfig): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });

  const now = Date.now();
  request.session.userId = userId;
  request.session.createdAt = now;
  request.session.lastSeenAt = now;
  request.session.absoluteExpiresAt = now + config.sessionAbsoluteMs;
  await saveSession(request);
}

export async function destroySession(request: Request, config: AuthConfig): Promise<void> {
  const response = request.res;
  if (!request.session) {
    response?.clearCookie(config.sessionCookieName, { path: '/' });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
  response?.clearCookie(config.sessionCookieName, { path: '/' });
}

export async function touchSession(request: Request, now = Date.now()): Promise<void> {
  if (!request.session) {
    return;
  }
  request.session.lastSeenAt = now;
  await saveSession(request);
}
