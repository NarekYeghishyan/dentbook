/**
 * Панель оператора платформы (Шаг 10, Q18): клиники и их блокировка, состояние платформы.
 * Оператор — владелец платформы, не сотрудник клиники: данных клиентов клиник он не видит.
 */
import { z } from 'zod';
import type { ClinicStatus, UserRole } from './domain.js';

/** Ответ на вход: панель по роли решает, куда вести — в журнал клиники или к оператору. */
export interface LoginResponse {
  role: UserRole;
}

export interface OperatorMe {
  id: string;
  fullName: string;
  email: string;
}

export interface OperatorClinic {
  id: string;
  name: string;
  status: ClinicStatus;
  timezone: string;
  createdAt: string;
  owner: { fullName: string; email: string } | null;
  dentists: number;
  /** Записи с визитом за последние 30 дней, кроме холдов и отменённых. */
  bookings30d: number;
  telegramDentists: number;
  lastBookingAt: string | null;
}

export const clinicStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });
export type ClinicStatusInput = z.input<typeof clinicStatusSchema>;

export interface QueueHealth {
  name: string;
  /** Очередь обслуживается: провайдер настроен. */
  enabled: boolean;
  waiting: number;
  delayed: number;
  active: number;
  failed: number;
}

export interface PlatformHealth {
  checkedAt: string;
  providers: { sms: boolean; captcha: boolean; telegram: boolean };
  queues: QueueHealth[];
  /** Неудачные уведомления за сутки по коду ошибки — без текста и получателей (§2.6). */
  failures24h: { channel: string; lastError: string | null; count: number }[];
}
