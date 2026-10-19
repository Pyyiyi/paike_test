import 'dotenv/config';
import path from 'node:path';
import { closePool, getPool } from '../shared/db/pool';
import { runMigrations } from '../shared/db/migrate';

async function main(): Promise<void> {
  await runMigrations({
    pool: getPool(),
    migrationsDir: path.resolve(process.cwd(), 'migrations'),
  });
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知迁移错误';
    console.error(`迁移失败：${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
