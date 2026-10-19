import 'dotenv/config';
import { createApp } from './app';
import { parseDatabaseConfig } from './config/database';
import { closePool } from './shared/db/pool';

function readPort(): number {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT 必须是 1-65535 的整数');
  }
  return port;
}

function main(): void {
  parseDatabaseConfig();
  const port = readPort();
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`后端已启动：http://localhost:${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`收到 ${signal}，正在关闭服务`);
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : '未知启动错误';
  console.error(`启动失败：${message}`);
  process.exitCode = 1;
}
