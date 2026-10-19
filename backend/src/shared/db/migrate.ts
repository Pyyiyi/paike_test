import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { executeTransaction } from './transaction';

export interface MigrationFile {
  version: number;
  filename: string;
  absolutePath: string;
  checksum: string;
}

export interface MigrationLogger {
  info(message: string): void;
}

export interface RunMigrationsOptions {
  pool: Pool;
  migrationsDir?: string;
  logger?: MigrationLogger;
}

export interface MigrationResult {
  applied: MigrationFile[];
  skipped: number;
  total: number;
}

export class MigrationFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationFileError';
  }
}

export class MigrationChecksumError extends Error {
  constructor(filename: string) {
    super(`已执行迁移 ${filename} 的 checksum 与磁盘文件不一致；迁移文件必须只追加，不得修改历史文件`);
    this.name = 'MigrationChecksumError';
  }
}

const MigrationFilenamePattern = /^(\d{4})_[a-z0-9_]+\.sql$/;

function checksumOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function loadMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'));
  const migrations: MigrationFile[] = [];
  const seenVersions = new Set<number>();

  for (const entry of sqlFiles) {
    const match = MigrationFilenamePattern.exec(entry.name);
    if (!match) {
      throw new MigrationFileError(`迁移文件名不合法：${entry.name}；必须为 NNNN_snake_case.sql`);
    }

    const version = Number.parseInt(match[1] ?? '', 10);
    if (seenVersions.has(version)) {
      throw new MigrationFileError(`迁移序号重复：${String(version).padStart(4, '0')}`);
    }
    seenVersions.add(version);

    const absolutePath = path.join(migrationsDir, entry.name);
    const content = await readFile(absolutePath, 'utf8');
    migrations.push({
      version,
      filename: entry.name,
      absolutePath,
      checksum: checksumOf(content),
    });
  }

  migrations.sort((left, right) => left.filename.localeCompare(right.filename, 'en'));
  if (migrations[0]?.version !== 1) {
    throw new MigrationFileError('迁移序号必须从 0001 开始');
  }
  // Cards reserve non-overlapping migration ranges (for example 0010-0015).
  // Gaps are intentional; filenames still execute in strict numeric order.

  return migrations;
}

interface LedgerRow {
  filename: string;
  checksum: string;
}

async function loadAppliedMigrations(
  client: Pick<PoolClient, 'query'>,
): Promise<Map<string, string>> {
  const table = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('sys_migration') IS NOT NULL AS exists",
  );
  if (!table.rows[0]?.exists) {
    return new Map();
  }

  const ledger = await client.query<LedgerRow>(
    'SELECT filename, checksum FROM sys_migration ORDER BY filename',
  );
  return new Map(ledger.rows.map((row) => [row.filename, row.checksum]));
}

export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationResult> {
  const migrationsDir = options.migrationsDir ?? path.resolve(process.cwd(), 'migrations');
  const logger = options.logger ?? console;
  const migrations = await loadMigrationFiles(migrationsDir);
  const client = await options.pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('paike_schema_migrations', 0))");
    lockAcquired = true;

    const applied = await loadAppliedMigrations(client);
    const diskFilenames = new Set(migrations.map((migration) => migration.filename));
    for (const filename of applied.keys()) {
      if (!diskFilenames.has(filename)) {
        throw new MigrationFileError(`账本中的迁移文件在磁盘上缺失：${filename}`);
      }
    }

    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.filename);
      if (appliedChecksum !== undefined && appliedChecksum !== migration.checksum) {
        throw new MigrationChecksumError(migration.filename);
      }
    }

    const pending = migrations.filter((migration) => !applied.has(migration.filename));
    for (const migration of pending) {
      const sql = await readFile(migration.absolutePath, 'utf8');
      const startedAt = performance.now();
      const durationMs = await executeTransaction(
        client,
        async (tx) => {
          await tx.query(sql);
          const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
          await tx.query(
            `INSERT INTO sys_migration
               (migration_id, filename, checksum, duration_ms, applied_by)
             VALUES ($1, $2, $3, $4, current_user)`,
            [randomUUID(), migration.filename, migration.checksum, elapsed],
          );
          return elapsed;
        },
        { timeoutMs: 120_000 },
      );
      logger.info(`已应用迁移 ${migration.filename}（${durationMs}ms）`);
    }

    if (pending.length === 0) {
      logger.info('无待执行迁移');
    } else {
      logger.info(`迁移完成：应用 ${pending.length} 个，跳过 ${migrations.length - pending.length} 个`);
    }

    return {
      applied: pending,
      skipped: migrations.length - pending.length,
      total: migrations.length,
    };
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended('paike_schema_migrations', 0))");
      } catch {
        // Releasing the connection below also releases session advisory locks.
      }
    }
    client.release();
  }
}
