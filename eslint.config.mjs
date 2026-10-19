import eslint from '@eslint/js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';
import boundaryZones from './eslint-boundary-zones.cjs';

const moduleContexts = readdirSync(join(process.cwd(), 'backend/src/modules'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const { createBoundaryZones } = boundaryZones;

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.npm-cache/**', 'var/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['frontend/src/**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: '组件和页面必须通过 shared/api/<domain>.api.ts 发起请求。',
        },
      ],
    },
  },
  {
    files: ['backend/src/**/*.ts', 'frontend/src/**/*.{ts,vue}'],
    plugins: {
      import: importPlugin,
    },
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
        { zones: createBoundaryZones(moduleContexts) },
      ],
    },
  },
  {
    files: ['frontend/src/shared/api/http.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    files: ['frontend/src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
);
