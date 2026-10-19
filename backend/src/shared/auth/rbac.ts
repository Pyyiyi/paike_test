import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError, createAppError } from '../errors/app-error';
import type { SecurityAuditInput } from '../audit/security-audit';
import { destroySession, touchSession } from './session';
import type { AuthRuntime } from './runtime';

export type UserRole = 'ADMIN' | 'TEACHER';
export type AccountStatus = 'ENABLED' | 'DISABLED';

export interface CurrentUser {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  teacherId: string | null;
  mustChangePassword: boolean;
}

interface UserRow {
  user_id: string;
  username: string;
  display_name: string;
  role: UserRole;
  status: AccountStatus;
  must_change_password: boolean;
  teacher_id: string | null;
}

async function safeAudit(runtime: AuthRuntime, input: SecurityAuditInput): Promise<void> {
  try {
    await runtime.writeAudit(input);
  } catch {
    // Audit failures must not break authentication, and must never log secrets.
  }
}

export async function loadCurrentUser(
  request: Request,
  runtime: AuthRuntime,
): Promise<CurrentUser | null> {
  if (!request.session || typeof request.session.userId !== 'string') {
    return null;
  }

  const sessionUserId = request.session.userId;
  const now = runtime.now();
  const createdAt = request.session.createdAt ?? now;
  const lastSeenAt = request.session.lastSeenAt ?? now;
  if (
    now - createdAt > runtime.config.sessionAbsoluteMs ||
    now - lastSeenAt > runtime.config.sessionIdleMs
  ) {
    await destroySession(request, runtime.config);
    await safeAudit(runtime, {
      actorId: sessionUserId,
      action: 'SESSION_EXPIRED',
      result: 'DENIED',
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
    return null;
  }

  const result = await runtime.pool.query<UserRow>(
    `SELECT user_id, username, display_name, role, status, must_change_password, teacher_id
     FROM sys_user
     WHERE user_id = $1`,
    [sessionUserId],
  );
  const row = result.rows[0];
  if (!row || row.status !== 'ENABLED') {
    await destroySession(request, runtime.config);
    if (row) {
      await safeAudit(runtime, {
        actorId: row.user_id,
        actorName: row.username,
        action: 'ACCOUNT_DISABLED_ACCESS',
        result: 'DENIED',
        ip: request.ip,
        userAgent: request.get('user-agent'),
        detail: { reason: 'DISABLED' },
      });
    }
    return null;
  }

  await touchSession(request, now);

  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    teacherId: row.teacher_id,
    mustChangePassword: row.must_change_password,
  };
}

export function createLoadCurrentUser(runtime: AuthRuntime): RequestHandler {
  return (request, _response, next: NextFunction) => {
    void loadCurrentUser(request, runtime)
      .then((user) => {
        request.currentUser = user;
        next();
      })
      .catch(next);
  };
}

export const requireAuth: RequestHandler = (request, _response, next) => {
  if (!request.currentUser) {
    next(createAppError('UNAUTHENTICATED', '登录已失效，请重新登录'));
    return;
  }
  next();
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.currentUser) {
      next(createAppError('UNAUTHENTICATED', '登录已失效，请重新登录'));
      return;
    }
    if (!roles.includes(request.currentUser.role)) {
      next(createAppError('FORBIDDEN', '您没有权限执行此操作'));
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('ADMIN');

const PASSWORD_CHANGE_ALLOWED_PATHS = [
  '/api/v1/auth/change-password',
  '/api/v1/auth/logout',
  '/api/v1/auth/csrf',
  '/api/v1/health',
];

export function createForcedPasswordChangeGuard(): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.currentUser?.mustChangePassword) {
      next();
      return;
    }

    const path = request.originalUrl.split('?')[0] ?? '';
    const allowed = PASSWORD_CHANGE_ALLOWED_PATHS.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (allowed) {
      next();
      return;
    }

    next(new AppError('STATE_CONFLICT', 403, '请先修改初始密码'));
  };
}
