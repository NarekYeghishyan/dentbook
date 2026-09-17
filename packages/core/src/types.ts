/**
 * Типы движка доступности (CLAUDE.md §6).
 * Пакет @dentbook/core не делает I/O и не импортирует ничего из apps/.
 * Всё время — UTC.
 */

/** Полуоткрытый интервал [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

export type ScheduleExceptionType = 'block' | 'extra';

export interface ScheduleException {
  type: ScheduleExceptionType;
  interval: Interval;
}

export interface BusyAppointment {
  interval: Interval;
  /** Буфер после записи, минуты. */
  bufferMin: number;
}

export interface ComputeSlotsInput {
  /** Рабочие часы на запрошенную дату, UTC. */
  workingHours: Interval[];
  exceptions: ScheduleException[];
  appointments: BusyAppointment[];
  /** Длительность услуги, минуты. */
  durationMin: number;
  /** Буфер услуги, минуты. */
  bufferMin: number;
  /** Шаг сетки слотов, минуты. */
  stepMin: number;
  /** now + min_lead_min: слоты раньше этого момента отбрасываются. */
  notBefore: Date;
}
