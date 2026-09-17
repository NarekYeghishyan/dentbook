import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseOptions {
  /** Размер пула соединений. */
  max?: number;
}

/**
 * Пул и Drizzle-клиент. Сессия всегда в UTC (CLAUDE.md §2.3): часовой пояс
 * сервера БД и приложения на вычисления влиять не должен.
 */
export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    options: '-c TimeZone=UTC',
  });
  const db: Database = drizzle(pool, { schema });
  return { db, pool };
}
