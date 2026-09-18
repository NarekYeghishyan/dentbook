import { defineConfig } from 'vitest/config';

// Сквозные тесты в браузере (Playwright): отдельно от `pnpm test`, запускаются через
// `pnpm test:e2e` — им нужен собранный виджет и установленный Chromium.
export default defineConfig({
  test: {
    include: ['apps/*/test/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
