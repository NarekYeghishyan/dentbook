/** Назначение врача при записи на «любого врача» (CLAUDE.md §6). */

export interface DentistCandidate {
  dentistId: string;
  /** dentists.priority: меньше — выше. */
  priority: number;
  /** Записи врача в этот местный день (статусы, занимающие время). */
  appointmentsThatDay: number;
}

const compare = (a: DentistCandidate, b: DentistCandidate): number =>
  a.priority - b.priority || a.appointmentsThatDay - b.appointmentsThatDay;

/**
 * Среди врачей, свободных на выбранное время: минимальный priority; при равенстве —
 * меньше записей в этот день; при равенстве — случайно.
 * random возвращает число из [0, 1), в тестах подменяется. Пустой список — undefined.
 */
export function pickDentist<T extends DentistCandidate>(
  candidates: readonly T[],
  random: () => number = Math.random,
): T | undefined {
  let best: T[] = [];
  for (const candidate of candidates) {
    const order = best[0] ? compare(candidate, best[0]) : -1;
    if (order < 0) best = [candidate];
    else if (order === 0) best.push(candidate);
  }
  const index = Math.floor(random() * best.length);
  return best[Math.min(Math.max(index, 0), best.length - 1)];
}
