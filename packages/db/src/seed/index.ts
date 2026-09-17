import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { createDatabase } from '../client.js';
import { seedDemo } from './demo.js';

// .env лежит в корне монорепо; скрипт запускается из packages/db
loadEnv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const env = z.object({ DATABASE_URL: z.string().min(1) }).safeParse(process.env);
if (!env.success) {
  throw new Error('DATABASE_URL is not set. Скопируйте .env.example в .env и заполните.');
}

const { db, pool } = createDatabase(env.data.DATABASE_URL, { max: 1 });

try {
  await seedDemo(db);
  process.stdout.write('seed: demo clinic is in place\n');
} finally {
  await pool.end();
}
