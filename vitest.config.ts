import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      '{apps,packages}/*/src/**/*.{test,spec}.ts',
      '{apps,packages}/*/test/**/*.{test,spec}.ts',
    ],
    // Браузерные сквозные тесты — отдельно: pnpm test:e2e (vitest.e2e.config.ts)
    exclude: ['**/node_modules/**', '**/*.e2e.test.ts'],
    // Интеграционные тесты на Testcontainers поднимают Postgres — нужен запас по времени
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/core/src/**', 'packages/shared/src/**', 'apps/api/src/**'],
      thresholds: {
        // Шаг 2: движок доступности — покрытие не ниже 90% (CLAUDE.md §10)
        'packages/core/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});
