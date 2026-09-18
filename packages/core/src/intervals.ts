/**
 * Арифметика полуоткрытых интервалов [start, end).
 * Внутри движка интервалы — миллисекунды UTC: так проще сравнивать и складывать.
 */
import type { Interval } from './types.js';

export const MINUTE_MS = 60_000;

/** Интервал в миллисекундах UTC. Границы могут быть ±Infinity. */
export interface Span {
  start: number;
  end: number;
}

export const toSpan = (interval: Interval): Span => ({
  start: interval.start.getTime(),
  end: interval.end.getTime(),
});

/** Сортирует, выбрасывает пустые, склеивает пересекающиеся и смежные интервалы. */
export function normalizeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const result: Span[] = [];
  for (const span of sorted) {
    const last = result.at(-1);
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      result.push({ ...span });
    }
  }
  return result;
}

/** base минус cut. Результат нормализован. */
export function subtractSpans(base: readonly Span[], cut: readonly Span[]): Span[] {
  const cuts = normalizeSpans(cut);
  const result: Span[] = [];
  for (const piece of normalizeSpans(base)) {
    let start = piece.start;
    for (const c of cuts) {
      if (c.end <= start) continue;
      if (c.start >= piece.end) break;
      if (c.start > start) result.push({ start, end: c.start });
      start = c.end;
      if (start >= piece.end) break;
    }
    if (start < piece.end) result.push({ start, end: piece.end });
  }
  return result;
}

/** Лежит ли [start, end) целиком внутри одного интервала нормализованного множества. */
export function coversSpan(set: readonly Span[], start: number, end: number): boolean {
  return set.some((s) => s.start <= start && end <= s.end);
}
