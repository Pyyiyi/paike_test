import type { Router } from 'express';
import type { AuthRuntime } from '../shared/auth/runtime';

export interface ModuleRouterContext {
  auth?: AuthRuntime;
}

export interface ModuleRouterExports {
  default?: unknown;
  router?: unknown;
  createRouter?: (
    context: ModuleRouterContext,
  ) => Router | null | Promise<Router | null>;
  [exportName: string]: unknown;
}

export interface ModuleRouterScanResult {
  files: string[];
  mounted: number;
  durationMs: number;
}
