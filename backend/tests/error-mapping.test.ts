import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
  createAppError,
} from '../src/shared/errors/app-error';
import { ERROR_HTTP_STATUS, ERROR_MESSAGES, type ErrorCode } from '../src/shared/errors/codes';

const conventionsMapping: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  DUPLICATE: 409,
  REFERENCE_PROTECTED: 409,
  STATE_CONFLICT: 409,
  FILE_TOO_LARGE: 413,
  IMPORT_ROW_ERROR: 422,
  ACCOUNT_LOCKED: 423,
  INTERNAL_ERROR: 500,
  DATABASE_UNAVAILABLE: 503,
};

describe('error codes and HTTP mapping', () => {
  it('covers every conventions §3.2 code with the correct status', () => {
    expect(ERROR_HTTP_STATUS).toEqual(conventionsMapping);

    for (const code of Object.keys(conventionsMapping) as ErrorCode[]) {
      const error = createAppError(code);
      expect(error.code).toBe(code);
      expect(error.httpStatus).toBe(conventionsMapping[code]);
      expect(error.message).toBe(ERROR_MESSAGES[code]);
      expect(error.details).toEqual([]);
    }
  });

  it('exposes user-facing defaults and typed details', () => {
    const validation = new ValidationError(undefined, [{ field: 'name', message: '名称不能为空' }]);
    expect(validation.code).toBe('VALIDATION_ERROR');
    expect(validation.httpStatus).toBe(400);
    expect(validation.message).toBe('保存失败，请检查输入内容');
    expect(validation.details).toEqual([{ field: 'name', message: '名称不能为空' }]);

    expect(new NotFoundError().httpStatus).toBe(404);
    expect(new ForbiddenError().httpStatus).toBe(403);
    expect(new ConflictError('DUPLICATE').httpStatus).toBe(409);
    expect(new ConflictError('REFERENCE_PROTECTED').code).toBe('REFERENCE_PROTECTED');
    expect(new ConflictError('STATE_CONFLICT').code).toBe('STATE_CONFLICT');
    expect(new VersionConflictError().code).toBe('VERSION_CONFLICT');
    expect(new VersionConflictError().httpStatus).toBe(409);
  });

  it('can be serialized without leaking a stack', () => {
    const error = new AppError('FORBIDDEN', 403, '没有权限');
    expect(error.name).toBe('AppError');
    expect(error.toJSON()).toEqual({ code: 'FORBIDDEN', message: '没有权限', details: [] });
    expect(JSON.stringify(error.toJSON())).not.toContain('stack');
  });
});
