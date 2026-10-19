import { ERROR_MESSAGES, type ErrorCode } from './codes';

export interface ErrorDetail {
  field?: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: ErrorCode, message?: string, details?: ErrorDetail[]) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
