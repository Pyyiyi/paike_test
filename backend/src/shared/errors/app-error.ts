import { ERROR_HTTP_STATUS, ERROR_MESSAGES, type ErrorCode } from './codes';

export interface ErrorDetail {
  field?: string;
  message: string;
  rowNo?: number;
  column?: string;
  rawValue?: string;
}

export type ConflictCode = 'DUPLICATE' | 'REFERENCE_PROTECTED' | 'STATE_CONFLICT';

/**
 * 应用层统一错误。message 面向用户，可直接展示；不得包含堆栈、SQL 或敏感信息。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetail[];

  constructor(
    code: ErrorCode,
    httpStatus: number,
    message: string,
    details: ErrorDetail[] = [],
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }

  toJSON(): { code: ErrorCode; message: string; details: ErrorDetail[] } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** 依据错误码创建 AppError，确保 HTTP 映射不会写错。 */
export function createAppError(
  code: ErrorCode,
  message: string = ERROR_MESSAGES[code],
  details: ErrorDetail[] = [],
  cause?: unknown,
): AppError {
  return new AppError(code, ERROR_HTTP_STATUS[code], message, details, cause);
}

export class ValidationError extends AppError {
  constructor(
    message: string = ERROR_MESSAGES.VALIDATION_ERROR,
    details: ErrorDetail[] = [],
    cause?: unknown,
  ) {
    super('VALIDATION_ERROR', ERROR_HTTP_STATUS.VALIDATION_ERROR, message, details, cause);
  }
}

export class NotFoundError extends AppError {
  constructor(
    message: string = ERROR_MESSAGES.NOT_FOUND,
    details: ErrorDetail[] = [],
    cause?: unknown,
  ) {
    super('NOT_FOUND', ERROR_HTTP_STATUS.NOT_FOUND, message, details, cause);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message: string = ERROR_MESSAGES.FORBIDDEN,
    details: ErrorDetail[] = [],
    cause?: unknown,
  ) {
    super('FORBIDDEN', ERROR_HTTP_STATUS.FORBIDDEN, message, details, cause);
  }
}

export class ConflictError extends AppError {
  constructor(
    code: ConflictCode = 'STATE_CONFLICT',
    message: string = ERROR_MESSAGES[code],
    details: ErrorDetail[] = [],
    cause?: unknown,
  ) {
    super(code, ERROR_HTTP_STATUS[code], message, details, cause);
  }
}

export class VersionConflictError extends AppError {
  constructor(
    message: string = ERROR_MESSAGES.VERSION_CONFLICT,
    details: ErrorDetail[] = [],
    cause?: unknown,
  ) {
    super('VERSION_CONFLICT', ERROR_HTTP_STATUS.VERSION_CONFLICT, message, details, cause);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
