/**
 * Postgres для интеграционных тестов: контейнер той же версии, что в docker-compose,
 * и схема из миграций. Только для тестов — в рабочий код не импортируется.
 * Миграции здесь применяет мигратор drizzle-orm: те же файлы, что у drizzle-kit (§9).
 */
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, type Database } from './client.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

// Версия как в CLAUDE.md §3 и docker-compose.yml
export const POSTGRES_IMAGE = 'postgres:16-alpine';

export interface TestDatabase {
  db: Database;
  url: string;
  stop(): Promise<void>;
}

export async function startTestDatabase(
  options: { poolSize?: number } = {},
): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const url = container.getConnectionUri();
  const { db, pool } = createDatabase(url, { max: options.poolSize ?? 10 });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    db,
    url,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
