import { defineConfig } from 'vite';

// Один IIFE-бандл (CLAUDE.md §3), бюджет — 50 КБ gzip (Шаг 6).
// Стили держим в TS-строке, а не в .css, чтобы сборка оставалась одним файлом.
export default defineConfig({
  build: {
    target: 'es2019',
    outDir: 'dist',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/index.ts',
      name: 'DentBook',
      formats: ['iife'],
      fileName: () => 'dentbook-widget.js',
    },
  },
});
