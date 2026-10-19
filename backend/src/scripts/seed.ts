import 'dotenv/config';
import path from 'node:path';
import { parseSeedConfig } from '../config/seed';
import { closePool, getPool } from '../shared/db/pool';
import { runMigrations } from '../shared/db/migrate';
import { reportSeedResult, runSeed } from '../shared/db/seed';

async function main(): Promise<void> {
  const config = parseSeedConfig();
  const pool = getPool();

  await runMigrations({
    pool,
    migrationsDir: path.resolve(process.cwd(), 'migrations'),
    logger: { info: (message) => console.log(message) },
  });

  const result = await runSeed({
    pool,
    ...config,
    anchorsPath: path.resolve(process.cwd(), 'seed-anchors.sql'),
  });
  reportSeedResult(result, (line) => console.log(line));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知 seed 错误';
    console.error(`Seed 失败：${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
