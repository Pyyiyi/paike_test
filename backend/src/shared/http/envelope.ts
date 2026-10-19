import type { Response } from 'express';
import type { AppError, ErrorDetail } from '../errors/app-error';

export interface SuccessEnvelope<T> {
  data: T;
}

export interface PageData<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
    requestId: string;
  };
}

function currentRequestId(response: Response): string {
  const value: unknown = response.locals?.requestId;
  return typeof value === 'string' ? value : '';
}

export function ok<T>(response: Response, data: T): void {
  response.status(200).json({ data } satisfies SuccessEnvelope<T>);
}

export function created<T>(response: Response, data: T): void {
  response.status(201).json({ data } satisfies SuccessEnvelope<T>);
}

export function noContent(response: Response): void {
  response.status(204).end();
}

export function paginated<T>(
  response: Response,
  items: T[],
  page: number,
  pageSize: number,
  total: number,
): void {
  const data: PageData<T> = { items, page, pageSize, total };
  response.status(200).json({ data } satisfies SuccessEnvelope<PageData<T>>);
}

export function fail(response: Response, error: AppError): void {
  const body: ErrorEnvelope = {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: currentRequestId(response),
    },
  };
  response.status(error.httpStatus).json(body);
}
