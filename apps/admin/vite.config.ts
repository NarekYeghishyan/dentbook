import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Админка живёт на /admin/ того же домена, что и API (Q14): cookie сессии без CORS
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // В разработке API — отдельный процесс; прокси сохраняет один origin, как в проде
    proxy: { '/v1': 'http://localhost:3000' },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Библиотеки меняются реже кода панели: отдельный файл остаётся в кеше браузера
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
