import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Mini App живёт на /miniapp/ того же домена, что и API (Q14)
  base: '/miniapp/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: { '/v1': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: true },
});
