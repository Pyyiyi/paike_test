import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ESLint } from 'eslint';
import importPlugin from 'eslint-plugin-import';
import { describe, expect, it } from 'vitest';

const localRequire = createRequire(__filename);
const { createBoundaryZones } = localRequire('../../eslint-boundary-zones.cjs') as {
  createBoundaryZones: (moduleContexts: string[]) => unknown[];
};
const cwd = path.resolve('.');

function restrictedPathMessage(messages: ESLint.LintResult['messages']) {
  return messages.find((message) => message.ruleId === 'import/no-restricted-paths');
}

describe('context boundary lint gate', () => {
  it('blocks shared imports from modules and reports the file and import path', async () => {
    const eslint = new ESLint({ cwd });
    const [result] = await eslint.lintText("import '../modules/auth/auth.router';\n", {
      filePath: path.join(cwd, 'backend/src/shared/boundary-violation.ts'),
    });
    const violation = restrictedPathMessage(result?.messages ?? []);

    expect(violation?.message).toContain('../modules/auth/auth.router');
    expect(result?.filePath).toBe(path.join(cwd, 'backend/src/shared/boundary-violation.ts'));
  });

  it('blocks cross-domain repository imports while allowing the current domain internals', async () => {
    const eslint = new ESLint({
      cwd,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          plugins: { import: importPlugin },
          settings: {
            'import/resolver': {
              node: {
                extensions: ['.ts', '.tsx', '.js', '.mjs'],
              },
            },
          },
          rules: {
            'import/no-restricted-paths': [
              'error',
              { zones: createBoundaryZones(['auth', 'timetable', 'boundary-test-domain']) },
            ],
          },
        },
      ],
    });

    const timetableDir = path.join(cwd, 'backend/src/modules/boundary-test-domain');
    mkdirSync(timetableDir, { recursive: true });
    try {
      const [crossDomain] = await eslint.lintText("import '../auth/auth.repository';\n", {
        filePath: path.join(timetableDir, 'boundary-violation.ts'),
      });
      const [sameDomain] = await eslint.lintText("import './auth.repository';\n", {
        filePath: path.join(cwd, 'backend/src/modules/auth/boundary-violation.ts'),
      });

      const violation = restrictedPathMessage(crossDomain?.messages ?? []);
      expect(violation?.message).toContain('../auth/auth.repository');
      expect(crossDomain?.filePath).toBe(path.join(timetableDir, 'boundary-violation.ts'));
      expect(restrictedPathMessage(sameDomain?.messages ?? [])).toBeUndefined();
    } finally {
      rmSync(timetableDir, { recursive: true, force: true });
    }
  });
});
