import express from 'express';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerModuleRouters } from '../src/modules';
import type { AuthRuntime } from '../src/shared/auth/runtime';

const fixturesDir = path.resolve('backend/tests/fixtures');

describe('module router hub', () => {
  it('discovers routers by convention and mounts both instance and factory exports', async () => {
    const app = express();
    const logs: string[] = [];

    const result = await registerModuleRouters(app, {
      modulesDir: path.join(fixturesDir, 'modules'),
      logger: { info: (message) => logs.push(message) },
    });

    expect(result.files.map((file) => path.basename(file))).toEqual([
      'alpha.router.ts',
      'beta.router.ts',
      'skip.router.ts',
    ]);
    expect(result.mounted).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const alpha = await request(app).get('/api/v1/alpha-probe');
    const beta = await request(app).get('/api/v1/beta-probe');
    expect(alpha.status).toBe(200);
    expect(alpha.body).toEqual({ data: { context: 'alpha' } });
    expect(beta.status).toBe(200);
    expect(beta.body).toEqual({ data: { context: 'beta' } });
    expect(logs[0]).toMatch(/发现 3 个文件，挂载 2 个，耗时 \d+(?:\.\d+)?ms/);
  });

  it('mounts a runtime-dependent module under its declared domain prefix', async () => {
    const app = express();
    const runtime = {
      config: { secureCookies: false, sessionIdleMs: 60_000 },
    } as unknown as AuthRuntime;

    await registerModuleRouters(app, { context: { auth: runtime } });
    const response = await request(app).get('/api/v1/auth/csrf');

    expect(response.status).toBe(200);
    expect(response.body.data.csrfToken).toEqual(expect.any(String));
  });

  it('rejects a router filename that does not match its context directory', async () => {
    await expect(
      registerModuleRouters(express(), {
        modulesDir: path.join(fixturesDir, 'modules-mismatch'),
      }),
    ).rejects.toThrow(/wrong\/other\.router\.ts 必须命名为 wrong\/wrong\.router\.ts/);
  });

  it('rejects a conventional file without a valid Router export', async () => {
    await expect(
      registerModuleRouters(express(), {
        modulesDir: path.join(fixturesDir, 'modules-invalid'),
      }),
    ).rejects.toThrow(/broken\/broken\.router\.ts 的 router 必须导出 Express Router/);
  });
});
