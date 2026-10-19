import { createRequire } from 'node:module';
import { basename, dirname, extname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import fg from 'fast-glob';
import type { Express, Router } from 'express';
import type {
  ModuleRouterContext,
  ModuleRouterExports,
  ModuleRouterScanResult,
} from './router-contract';

export type {
  ModuleRouterContext,
  ModuleRouterExports,
  ModuleRouterScanResult,
} from './router-contract';

export interface RegisterModuleRoutersOptions {
  modulesDir?: string;
  context?: ModuleRouterContext;
  mountPath?: string;
  extension?: string;
  logger?: Pick<Console, 'info'>;
}

const localRequire = createRequire(__filename);

function displayPath(modulesDir: string, file: string): string {
  return relative(modulesDir, file).replaceAll('\\', '/');
}

async function loadRouterModule(file: string): Promise<ModuleRouterExports> {
  if (extname(file) === '.js') {
    return localRequire(file) as ModuleRouterExports;
  }
  return import(pathToFileURL(file).href) as Promise<ModuleRouterExports>;
}

function assertRouter(
  candidate: unknown,
  modulesDir: string,
  file: string,
  exportName: string,
): asserts candidate is Router {
  if (
    typeof candidate !== 'function'
    || typeof (candidate as { use?: unknown }).use !== 'function'
  ) {
    throw new Error(
      `模块路由加载失败：${displayPath(modulesDir, file)} 的 ${exportName} 必须导出 Express Router`,
    );
  }
}

async function resolveRouter(
  moduleExports: ModuleRouterExports,
  modulesDir: string,
  file: string,
  contextName: string,
  context: ModuleRouterContext,
): Promise<Router | null> {
  const conventionalExport = `${contextName}Router`;
  const instanceCandidates = [
    ['router', moduleExports.router],
    ['default', moduleExports.default],
    [conventionalExport, moduleExports[conventionalExport]],
  ].filter((entry): entry is [string, unknown] => entry[1] !== undefined);

  const hasFactory = typeof moduleExports.createRouter !== 'undefined';
  if (instanceCandidates.length + Number(hasFactory) !== 1) {
    throw new Error(
      `模块路由加载失败：${displayPath(modulesDir, file)} 必须且只能导出 router、default、${conventionalExport} 或 createRouter 之一`,
    );
  }

  if (hasFactory) {
    if (typeof moduleExports.createRouter !== 'function') {
      throw new Error(
        `模块路由加载失败：${displayPath(modulesDir, file)} 的 createRouter 必须为函数`,
      );
    }
    const created = await moduleExports.createRouter(context);
    if (created === null) {
      return null;
    }
    assertRouter(created, modulesDir, file, 'createRouter 返回值');
    return created;
  }

  const [exportName, candidate] = instanceCandidates[0] as [string, unknown];
  assertRouter(candidate, modulesDir, file, exportName);
  return candidate;
}

export async function registerModuleRouters(
  app: Express,
  options: RegisterModuleRoutersOptions = {},
): Promise<ModuleRouterScanResult> {
  const startedAt = performance.now();
  const modulesDir = options.modulesDir ?? __dirname;
  const extension = options.extension ?? extname(__filename);
  const mountPath = options.mountPath ?? '/api/v1';
  const context = options.context ?? {};
  const files = (
    await fg(`*/*.router${extension}`, {
      cwd: modulesDir,
      absolute: true,
      onlyFiles: true,
      unique: true,
    })
  ).sort((left, right) => left.localeCompare(right));

  let mounted = 0;
  for (const file of files) {
    const contextName = basename(dirname(file));
    const expectedFilename = `${contextName}.router${extension}`;
    if (basename(file) !== expectedFilename) {
      throw new Error(
        `模块路由命名错误：${displayPath(modulesDir, file)} 必须命名为 ${contextName}/${expectedFilename}`,
      );
    }

    const moduleExports = await loadRouterModule(file);
    const router = await resolveRouter(moduleExports, modulesDir, file, contextName, context);
    if (router === null) {
      continue;
    }
    app.use(mountPath, router);
    mounted += 1;
  }

  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  options.logger?.info(
    `[hub] 模块路由扫描完成：发现 ${files.length} 个文件，挂载 ${mounted} 个，耗时 ${durationMs}ms`,
  );
  return { files, mounted, durationMs };
}
