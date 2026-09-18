/**
 * Подтверждение телефона SMS-кодом (§7 POST /verifications). Код — 6 цифр, живёт 5 минут,
 * 3 попытки (Q4). В БД — только HMAC кода с серверным секретом, сам код не хранится.
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { clinics, phoneVerifications, type Database, type Transaction } from '@dentbook/db';
import type { Locale } from '@dentbook/shared/domain';
import type { VerificationResponse } from '@dentbook/shared';
import { translate } from '../i18n/index.js';
import { ApiError } from '../lib/errors.js';
import type { SmsSender } from './sms.js';

export const VERIFICATION_TTL_SEC = 5 * 60;
export const VERIFICATION_MAX_ATTEMPTS = 3;
/** Кодов на один номер в час: SMS платные, а отправка — лёгкая цель для накрутки. */
export const VERIFICATION_SENDS_PER_HOUR = 5;

export const verificationFailed = (message = 'The code is wrong, expired or already used') =>
  new ApiError(400, 'verification_failed', message);

/** Ключ HMAC кодов — производный от JWT_SECRET: отдельная переменная не нужна. */
export const deriveVerificationKey = (jwtSecret: string) =>
  createHmac('sha256', jwtSecret).update('dentbook:phone-verification:v1').digest();

const codeHash = (key: Buffer, verificationId: string, code: string) =>
  createHmac('sha256', key).update(`${verificationId}:${code}`).digest('hex');

export async function createVerification(
  db: Database,
  sms: SmsSender | undefined,
  params: { clinicId: string; phone: string; locale?: Locale | undefined; now: Date; key: Buffer },
): Promise<VerificationResponse> {
  const { clinicId, phone, now } = params;
  if (!sms) throw new ApiError(503, 'internal_error', 'SMS is not configured');

  const sentLastHour = await db.$count(
    phoneVerifications,
    and(
      eq(phoneVerifications.clinicId, clinicId),
      eq(phoneVerifications.phone, phone),
      gt(phoneVerifications.createdAt, new Date(now.getTime() - 60 * 60_000)),
    ),
  );
  if (sentLastHour >= VERIFICATION_SENDS_PER_HOUR) {
    throw new ApiError(429, 'rate_limited', 'Too many codes for this phone number');
  }

  const [clinic] = await db
    .select({ name: clinics.name, locale: clinics.locale })
    .from(clinics)
    .where(eq(clinics.id, clinicId));
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_SEC * 1000);
  await db.insert(phoneVerifications).values({
    id,
    clinicId,
    phone,
    codeHash: codeHash(params.key, id, code),
    expiresAt,
  });
  const locale = params.locale ?? (clinic!.locale as Locale);
  await sms.send({
    to: phone,
    text: translate(locale, 'sms.verificationCode', { code, clinic: clinic!.name }),
  });
  return { verification_id: id, expires_at: expiresAt.toISOString() };
}

/**
 * Проверка кода. Попытка списывается отдельным запросом до проверки — и остаётся списанной,
 * даже если код неверный. Возвращает, только если код подходит к этому номеру.
 */
export async function checkCode(
  db: Database,
  params: {
    clinicId: string;
    verificationId: string;
    phone: string;
    code: string;
    now: Date;
    key: Buffer;
  },
): Promise<void> {
  const { clinicId, verificationId, now } = params;
  const known = await db.$count(
    phoneVerifications,
    and(eq(phoneVerifications.id, verificationId), eq(phoneVerifications.clinicId, clinicId)),
  );
  if (known === 0) throw new ApiError(400, 'verification_required', 'Verify the phone first');

  const [row] = await db
    .update(phoneVerifications)
    .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
    .where(
      and(
        eq(phoneVerifications.id, verificationId),
        eq(phoneVerifications.clinicId, clinicId),
        isNull(phoneVerifications.consumedAt),
        gt(phoneVerifications.expiresAt, now),
        lt(phoneVerifications.attempts, VERIFICATION_MAX_ATTEMPTS),
      ),
    )
    .returning({ phone: phoneVerifications.phone, codeHash: phoneVerifications.codeHash });
  if (!row || row.phone !== params.phone) throw verificationFailed();

  const expected = Buffer.from(row.codeHash, 'hex');
  const actual = Buffer.from(codeHash(params.key, verificationId, params.code), 'hex');
  if (!timingSafeEqual(expected, actual)) throw verificationFailed();
}

/** Один код — одна запись: второй раз израсходовать не получится. */
export async function consumeVerification(
  tx: Transaction,
  params: { clinicId: string; verificationId: string; now: Date },
): Promise<void> {
  const rows = await tx
    .update(phoneVerifications)
    .set({ verifiedAt: params.now, consumedAt: params.now })
    .where(
      and(
        eq(phoneVerifications.id, params.verificationId),
        eq(phoneVerifications.clinicId, params.clinicId),
        isNull(phoneVerifications.consumedAt),
      ),
    )
    .returning({ id: phoneVerifications.id });
  if (rows.length === 0) throw verificationFailed();
}
