import type { RouteRecordRaw } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { collectDomainRoutes } from './route-registry';

function route(path: string, name: string): RouteRecordRaw {
  return { path, name, component: { template: '<div />' } };
}

describe('frontend route hub', () => {
  it('sorts modules by file path and merges every exported route array', () => {
    const result = collectDomainRoutes({
      '../views/zeta/routes.ts': { routes: [route('/zeta', 'zeta')] },
      '../views/alpha/routes.ts': { routes: [route('/alpha', 'alpha')] },
    });

    expect(result.map((entry) => entry.name)).toEqual(['alpha', 'zeta']);
  });

  it('reports the file when a conventional module does not export a routes array', () => {
    expect(() =>
      collectDomainRoutes({ '../views/broken/routes.ts': { routes: undefined } }),
    ).toThrow(/views\/broken\/routes\.ts 必须导出 routes 数组/);
  });

  it('reports both files when route names collide', () => {
    expect(() =>
      collectDomainRoutes({
        '../views/alpha/routes.ts': { routes: [route('/alpha', 'duplicate')] },
        '../views/beta/routes.ts': { routes: [route('/beta', 'duplicate')] },
      }),
    ).toThrow(/views\/beta\/routes\.ts 的路由名 duplicate 已由 \.\.\/views\/alpha\/routes\.ts 注册/);
  });

  it('reports both files when route paths collide', () => {
    expect(() =>
      collectDomainRoutes({
        '../views/alpha/routes.ts': { routes: [route('/same', 'alpha')] },
        '../views/beta/routes.ts': { routes: [route('/same', 'beta')] },
      }),
    ).toThrow(/views\/beta\/routes\.ts 的路由路径 \/same 已由 \.\.\/views\/alpha\/routes\.ts 注册/);
  });

  it('discovers all real view route files through the Vite glob convention', async () => {
    const actualModules = import.meta.glob<{ routes: RouteRecordRaw[] }>(
      '../views/*/routes.ts',
      { eager: true },
    );
    const { domainRoutes } = await import('./index');
    const actualCount = Object.values(actualModules).reduce(
      (total, module) => total + module.routes.length,
      0,
    );

    expect(domainRoutes).toHaveLength(actualCount);
    expect(domainRoutes.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['overview', 'semesters', 'my-timetable']),
    );
  });
});
