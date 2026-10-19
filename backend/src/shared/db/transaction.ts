import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { getPool } from './pool';

export type TransactionIsolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  isolation?: TransactionIsolation;
  timeoutMs?: number;
}

export interface Tx {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
  queryMany<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}

function createTx(client: PoolClient): Tx {
  const query = async <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    const result = await client.query<T>(sql, params);
    return result.rows;
  };

  return {
    query,
    queryMany: query,
    async queryOne<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T | null> {
      const rows = await query<T>(sql, params);
      return rows[0] ?? null;
    },
  };
}

export async function executeTransaction<T>(
  client: PoolClient,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const isolation = options.isolation ?? 'READ COMMITTED';

  await client.query('BEGIN');
  try {
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
    if (options.timeoutMs !== undefined) {
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(options.timeoutMs),
      ]);
    }

    const result = await fn(createTx(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction error.
    }
    throw error;
  }
}

export async function withTransactionOn<T>(
  pool: Pool,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    return await executeTransaction(client, fn, options);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return withTransactionOn(getPool(), fn, options);
}
