import { Router } from 'express';
import { z } from 'zod';
import { issueCsrfToken } from '../../shared/auth/csrf';
import { normalizeIp } from '../../shared/auth/ip';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../../shared/auth/password';
import { requireAuth, type CurrentUser } from '../../shared/auth/rbac';
import type { AuthRuntime } from '../../shared/auth/runtime';
import { createSession, destroySession } from '../../shared/auth/session';
import { createAppError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/http/async-handler';
import { findUserById, findUserByUsername, markLoginSuccess, updateUserPassword } from './auth.repository';

const LoginSchema = z.object({
  username: z.string({ required_error: '请输入用户名' }).trim().min(1, '请输入用户名').max(64, '用户名过长'),
  password: z.string({ required_error: '请输入密码' }).min(1, '请输入密码').max(256, '密码过长'),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string({ required_error: '请输入当前密码' }).min(1, '请输入当前密码').max(256, '密码过长'),
  newPassword: z.string({ required_error: '请输入新密码' }).min(1, '请输入新密码').max(256, '密码过长'),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createAppError('VALIDATION_ERROR',
      '保存失败，请检查输入内容',
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || undefined,
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function toUserDto(user: CurrentUser) {
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    teacherId: user.teacherId,
    mustChangePassword: user.mustChangePassword,
  };
}

export function createAuthRouter(runtime: AuthRuntime): Router {
  const router = Router();

  router.get('/csrf', (_request, response) => {
    const csrfToken = issueCsrfToken(response, runtime.config);
    response.json({ data: { csrfToken } });
  });

  router.post(
    '/login',
    asyncHandler(async (request, response) => {
      const input = parseBody(LoginSchema, request.body);
      const username = input.username.trim();
      const ip = normalizeIp(request.ip);
      const userAgent = request.get('user-agent') ?? undefined;

      const remainingSeconds = await runtime.lockout.lockRemainingSeconds(username, ip);
      if (remainingSeconds > 0) {
        await runtime.writeAudit({
          actorName: username,
          action: 'LOGIN',
          result: 'DENIED',
          ip,
          userAgent,
          detail: { reason: 'ACCOUNT_LOCKED' },
        });
        throw createAppError('ACCOUNT_LOCKED',
          `登录失败次数过多，请 ${Math.max(1, Math.ceil(remainingSeconds / 60))} 分钟后再试`,
        );
      }

      const user = await findUserByUsername(runtime.pool, username);
      if (!user) {
        await runtime.lockout.recordFailure(username, ip, 'USER_NOT_FOUND');
        await runtime.writeAudit({
          actorName: username,
          action: 'LOGIN',
          result: 'FAILURE',
          ip,
          userAgent,
          detail: { reason: 'INVALID_CREDENTIALS' },
        });
        throw createAppError('UNAUTHENTICATED', '用户名或密码错误');
      }

      if (user.status !== 'ENABLED') {
        await runtime.lockout.recordFailure(username, ip, 'ACCOUNT_DISABLED');
        await runtime.writeAudit({
          actorId: user.userId,
          actorName: user.username,
          action: 'LOGIN',
          result: 'FAILURE',
          ip,
          userAgent,
          detail: { reason: 'ACCOUNT_DISABLED' },
        });
        throw createAppError('FORBIDDEN', '账号已停用，请联系管理员');
      }

      const passwordMatches = await verifyPassword(user.passwordHash, input.password);
      if (!passwordMatches) {
        await runtime.lockout.recordFailure(username, ip, 'INVALID_PASSWORD');
        await runtime.writeAudit({
          actorId: user.userId,
          actorName: user.username,
          action: 'LOGIN',
          result: 'FAILURE',
          ip,
          userAgent,
          detail: { reason: 'INVALID_CREDENTIALS' },
        });
        throw createAppError('UNAUTHENTICATED', '用户名或密码错误');
      }

      await runtime.lockout.recordSuccess(username, ip);
      await markLoginSuccess(runtime.pool, user.userId);
      await createSession(request, user.userId, runtime.config);
      await runtime.writeAudit({
        actorId: user.userId,
        actorName: user.username,
        action: 'LOGIN',
        result: 'SUCCESS',
        ip,
        userAgent,
        detail: { role: user.role },
      });

      response.json({ data: { user: toUserDto(user) } });
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    asyncHandler(async (request, response) => {
      const user = request.currentUser as CurrentUser;
      await runtime.writeAudit({
        actorId: user.userId,
        actorName: user.username,
        action: 'LOGOUT',
        result: 'SUCCESS',
        ip: normalizeIp(request.ip),
        userAgent: request.get('user-agent') ?? undefined,
      });
      await destroySession(request, runtime.config);
      response.json({ data: { ok: true } });
    }),
  );

  router.get('/me', requireAuth, (request, response) => {
    response.json({ data: { user: toUserDto(request.currentUser as CurrentUser) } });
  });

  router.post(
    '/change-password',
    requireAuth,
    asyncHandler(async (request, response) => {
      const currentUser = request.currentUser as CurrentUser;
      const input = parseBody(ChangePasswordSchema, request.body);

      if (input.currentPassword === input.newPassword) {
        throw createAppError('VALIDATION_ERROR', '新密码不能与当前密码相同', [
          { field: 'newPassword', message: '新密码不能与当前密码相同' },
        ]);
      }

      const user = await findUserById(runtime.pool, currentUser.userId);
      if (!user) {
        throw createAppError('UNAUTHENTICATED', '登录已失效，请重新登录');
      }

      const currentMatches = await verifyPassword(user.passwordHash, input.currentPassword);
      if (!currentMatches) {
        throw createAppError('VALIDATION_ERROR', '当前密码不正确', [
          { field: 'currentPassword', message: '当前密码不正确' },
        ]);
      }

      const policy = validatePasswordPolicy(input.newPassword, {
        minLength: runtime.config.passwordMinLength,
        requiredClasses: runtime.config.passwordRequiredClasses,
      });
      if (!policy.ok) {
        throw createAppError('VALIDATION_ERROR', policy.message, [
          { field: 'newPassword', message: policy.message },
        ]);
      }

      const passwordHash = await hashPassword(input.newPassword, {
        memoryCost: runtime.config.argon2MemoryCost,
        timeCost: runtime.config.argon2TimeCost,
        parallelism: runtime.config.argon2Parallelism,
      });
      await updateUserPassword(runtime.pool, currentUser.userId, passwordHash);
      await runtime.writeAudit({
        actorId: currentUser.userId,
        actorName: currentUser.username,
        action: 'CHANGE_PASSWORD',
        result: 'SUCCESS',
        ip: normalizeIp(request.ip),
        userAgent: request.get('user-agent') ?? undefined,
      });

      response.json({ data: { ok: true } });
    }),
  );

  return router;
}
