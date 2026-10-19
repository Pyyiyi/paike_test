import type { Pool, QueryResultRow } from 'pg';
import { createDatabasePool, parseDatabaseConfig } from '../../config/database';

let poolInstance: Pool | undefined;

export function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = createDatabasePool(parseDatabaseConfig());
  }
  return poolInstance;
}

// A lazy proxy keeps startup validation at first database use while preserving
// the shared-kernel contract that `db` is a pg.Pool.
export const db = new Proxy({} as Pool, {
  get(_target, property) {
    const pool = getPool();
    const value = Reflect.get(pool, property, pool) as unknown;
    return typeof value === 'function' ? value.bind(pool) : value;
  },
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function queryMany<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return query<T>(sql, params);
}

export async function healthCheck(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (!poolInstance) {
    return;
  }
  const pool = poolInstance;
  poolInstance = undefined;
  await pool.end();
}
