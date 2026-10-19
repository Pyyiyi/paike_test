import type { QueryResultRow } from 'pg';
import { NotFoundError, VersionConflictError } from '../errors/app-error';
import type { Tx } from './transaction';

export interface Versioned {
  version: number;
}

export interface OptimisticUpdateInput {
  table: string;
  id: string;
  expectedVersion: number;
  values: Record<string, unknown>;
  idColumn?: string;
  versionColumn?: string;
  returning?: string;
  message?: string;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(value: string, label: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label}不是合法的 SQL 标识符`);
  }
  return value;
}

/** 在调用仓储之前校验客户端携带的版本，避免无意义的写库。 */
export function assertVersionMatches(
  currentVersion: number | null | undefined,
  expectedVersion: number,
  message?: string,
): void {
  if (currentVersion !== expectedVersion) {
    throw new VersionConflictError(message);
  }
}

/** 读取聚合后、写库前使用：版本不一致立即抛 VERSION_CONFLICT，仓储不会被调用。 */
export function guardVersion<T extends Versioned>(
  entity: T | null | undefined,
  expectedVersion: number,
  message?: string,
): T {
  if (!entity) {
    throw new NotFoundError();
  }
  assertVersionMatches(entity.version, expectedVersion, message);
  return entity;
}

/**
 * 数据库层兜底：UPDATE ... WHERE id = $ AND version = $，0 行即抛 VERSION_CONFLICT。
 * 版本不匹配时不会修改任何数据。
 */
export async function updateWithVersion<T extends QueryResultRow = QueryResultRow>(
  tx: Tx,
  input: OptimisticUpdateInput,
): Promise<T> {
  const table = assertIdentifier(input.table, '表名');
  const idColumn = assertIdentifier(input.idColumn ?? 'id', '主键列名');
  const versionColumn = assertIdentifier(input.versionColumn ?? 'version', '版本列名');
  const columns = Object.keys(input.values);

  if (columns.length === 0) {
    throw new Error('乐观锁更新至少需要一个业务字段');
  }

  const assignments = columns.map(
    (column, index) => `${assertIdentifier(column, '字段名')} = $${index + 1}`,
  );
  assignments.push(`${versionColumn} = ${versionColumn} + 1`);

  const versionParameter = columns.length + 1;
  const idParameter = columns.length + 2;
  const params = [
    ...columns.map((column) => input.values[column]),
    input.expectedVersion,
    input.id,
  ];

  const rows = await tx.query<T>(
    `UPDATE ${table}
        SET ${assignments.join(', ')}
      WHERE ${idColumn} = $${idParameter}
        AND ${versionColumn} = $${versionParameter}
      RETURNING ${input.returning ?? '*'}`,
    params,
  );

  const updated = rows[0];
  if (!updated) {
    throw new VersionConflictError(input.message);
  }
  return updated;
}
