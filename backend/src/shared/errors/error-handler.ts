import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { maskSensitiveText } from '../audit/redact';
import { fail } from '../http/envelope';
import {
  AppError,
  NotFoundError,
  ValidationError,
  createAppError,
  type ErrorDetail,
} from './app-error';

function detailsFromZod(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
  }));
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof ZodError) {
    return new ValidationError(undefined, detailsFromZod(error), error);
  }
  return createAppError('INTERNAL_ERROR', undefined, [], error);
}

export function notFoundHandler(_request: Request, response: Response): void {
  fail(response, new NotFoundError('接口不存在'));
}

export function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  const appError = normalizeError(error);

  if (appError.httpStatus >= 500) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
    console.error(`[${request.requestId ?? ''}] 请求处理失败：${maskSensitiveText(reason)}`);
  }

  fail(response, appError);
}
