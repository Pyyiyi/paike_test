import type { RouteRecordRaw } from 'vue-router';

export type DomainRouteModule = {
  routes?: unknown;
};

function assertRouteRecords(file: string, routes: unknown): asserts routes is RouteRecordRaw[] {
  if (!Array.isArray(routes)) {
    throw new Error(`前端路由发现失败：${file} 必须导出 routes 数组`);
  }

  for (const [index, route] of routes.entries()) {
    if (
      typeof route !== 'object'
      || route === null
      || typeof (route as { path?: unknown }).path !== 'string'
    ) {
      throw new Error(`前端路由发现失败：${file} 的第 ${index + 1} 项缺少字符串 path`);
    }
  }
}

export function collectDomainRoutes(
  modules: Record<string, DomainRouteModule>,
): RouteRecordRaw[] {
  const sortedModules = Object.entries(modules).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const names = new Map<string, string>();
  const paths = new Map<string, string>();
  const collected: RouteRecordRaw[] = [];

  for (const [file, module] of sortedModules) {
    assertRouteRecords(file, module.routes);

    for (const route of module.routes) {
      if (typeof route.name === 'string') {
        const previousFile = names.get(route.name);
        if (previousFile) {
          throw new Error(
            `前端路由发现失败：${file} 的路由名 ${route.name} 已由 ${previousFile} 注册`,
          );
        }
        names.set(route.name, file);
      }

      const previousPathFile = paths.get(route.path);
      if (previousPathFile) {
        throw new Error(
          `前端路由发现失败：${file} 的路由路径 ${route.path || '(空路径)'} 已由 ${previousPathFile} 注册`,
        );
      }
      paths.set(route.path, file);
      collected.push(route);
    }
  }

  return collected;
}
