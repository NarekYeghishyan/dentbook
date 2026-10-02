/**
 * История записи (appointment_events): что, кем и когда изменено. Её видят врач в Mini App
 * и регистратура в журнале — `GET …/appointments/:id/history`.
 */
import type { AppointmentActor, AppointmentEventType } from './domain.js';

export interface ClientSnapshot {
  fullName: string;
  phone: string;
}

/**
 * Что изменилось: прежнее и новое значение. Время — ISO UTC. Врач в БД хранится как id,
 * в ответе API — имя.
 */
export interface AppointmentChanges {
  /** У created — на какое время записали (from = null). */
  startAt?: { from: string | null; to: string };
  dentist?: { from: string; to: string };
  client?: { from: ClientSnapshot | null; to: ClientSnapshot };
  notes?: { from: string | null; to: string | null };
}

export interface AppointmentEvent {
  id: string;
  at: string;
  type: AppointmentEventType;
  actor: AppointmentActor;
  /** Имя сотрудника или врача; null — клиент, система или сотрудник неизвестен. */
  actorName: string | null;
  changes: AppointmentChanges | null;
}

export interface AppointmentHistory {
  /** Пояс офиса записи — в нём показывать время (§2.3). */
  timeZone: string;
  /** От старых к новым. */
  events: AppointmentEvent[];
}
