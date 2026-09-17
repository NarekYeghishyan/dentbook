import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// .env лежит в корне монорепо, а drizzle-kit запускается из packages/db
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Скопируйте .env.example в .env и заполните.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
