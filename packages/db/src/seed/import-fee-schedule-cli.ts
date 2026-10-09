/**
 * pnpm --filter @dentbook/db import:fees --clinic <uuid> [--public]
 * Загружает услуги из прайса (fee-schedule.ts) в клинику той БД, что указана в DATABASE_URL.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { createDatabase } from '../client.js';
import { importFeeSchedule } from './import-fee-schedule.js';

loadEnv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const { values } = parseArgs({
  options: { clinic: { type: 'string' }, public: { type: 'boolean', default: false } },
});
const clinic = z.uuid().safeParse(values.clinic);
if (!clinic.success) {
  throw new Error('Pass the clinic id: --clinic <uuid> (add --public to show them in the widget)');
}
const env = z.object({ DATABASE_URL: z.string().min(1) }).safeParse(process.env);
if (!env.success) {
  throw new Error('DATABASE_URL is not set. Скопируйте .env.example в .env и заполните.');
}

const { db, pool } = createDatabase(env.data.DATABASE_URL, { max: 1 });
try {
  const result = await importFeeSchedule(db, clinic.data, { isPublic: values.public });
  process.stdout.write(
    `fees: ${result.created} created, ${result.existing} already there (clinic ${clinic.data})\n`,
  );
} finally {
  await pool.end();
}
