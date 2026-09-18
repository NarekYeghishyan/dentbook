/**
 * Оператор платформы (Шаг 10): создать или сбросить пароль. Регистрации операторов через
 * API нет — только этой командой на сервере (deploy/README.md):
 *
 *   docker compose run --rm --no-deps api node --import tsx apps/api/src/create-operator.ts \
 *     owner@example.com "Platform Owner"
 *
 * Пароль генерируется и печатается один раз; повторный запуск для того же email выдаёт
 * новый пароль.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDatabase, users } from '@dentbook/db';
import { emailSchema, nameSchema } from '@dentbook/shared';
import { loadEnv } from './env.js';
import { hashPassword } from './lib/password.js';

const [emailArg, nameArg] = process.argv.slice(2);
const email = emailSchema.safeParse(emailArg);
const fullName = nameSchema.safeParse(nameArg ?? 'Platform operator');
if (!email.success || !fullName.success) {
  process.stderr.write('Usage: create-operator.ts <email> [full name]\n');
  process.exit(2);
}

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL, { max: 1 });
try {
  const password = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(password);
  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email.data));
  if (existing && existing.role !== 'operator') {
    throw new Error('This email belongs to a clinic user; use another email for the operator');
  }
  if (existing) {
    await db
      .update(users)
      .set({ passwordHash, fullName: fullName.data, isActive: true })
      .where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({
      clinicId: null,
      email: email.data,
      passwordHash,
      fullName: fullName.data,
      role: 'operator',
    });
  }
  // Пароль — единственный раз: сохранить в менеджере паролей
  process.stdout.write(
    `${existing ? 'Password reset' : 'Operator created'}: ${email.data}\npassword: ${password}\n`,
  );
} finally {
  await pool.end();
}
