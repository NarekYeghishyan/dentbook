import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      '{apps,packages}/*/src/**/*.{test,spec}.ts',
      '{apps,packages}/*/test/**/*.{test,spec}.ts',
    ],
    // Интеграционные тесты на Testcontainers поднимают Postgres — нужен запас по времени
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/core/src/**', 'packages/shared/src/**', 'apps/api/src/**'],
    },
  },
});
