import type { Router } from 'express';
import type { AuthRuntime } from '../shared/auth/runtime';
import type { Clock } from '../shared/time/clock';

export interface ModuleRouterContext {
  auth?: AuthRuntime;
  clock?: Clock;
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
