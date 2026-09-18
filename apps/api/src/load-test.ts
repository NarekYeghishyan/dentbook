/**
 * Нагрузочный тест записи (Шаг 10): N клиентов одновременно берут один слот через
 * публичный API. Получить его может столько клиентов, сколько врачей свободно в это время;
 * у одного врача — ровно один (§2.1). Остальные — 409 slot_taken.
 *
 *   node --import tsx apps/api/src/load-test.ts --api https://dentbook.example.com \
 *     --key pk_… --origin https://clinic.example.com --service <uuid> --location <uuid> \
 *     [--start 2026-09-21T14:00:00Z] [--n 50]
 *
 * Без --start берётся первый свободный слот. Подтверждение записи требует кода из SMS,
 * поэтому здесь проверяются холды; полный цикл с кодом — в load.integration.test.ts.
 * Лимит холдов с одного IP (PUBLIC_IP_RATE_LIMIT) должен пропускать N запросов в минуту.
 * Холды победителей отпускаются в конце — слот снова свободен.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { PublicAvailability } from '@dentbook/shared';

export interface RaceOptions {
  api: string;
  key: string;
  origin: string;
  serviceId: string;
  locationId: string;
  startAt: string;
  n: number;
}

export interface RaceResult {
  /** HTTP-статус → число ответов. */
  statuses: Record<number, number>;
  latenciesMs: number[];
  /** Удачные холды: { hold_id, dentist, … }. */
  holds: { hold_id: string; dentist: { id: string } }[];
}

const headersOf = (options: RaceOptions) => ({
  authorization: `Bearer ${options.key}`,
  origin: options.origin,
  'content-type': 'application/json',
});

/** N одновременных POST /v1/public/holds на одно время. */
export async function raceHolds(options: RaceOptions): Promise<RaceResult> {
  const result: RaceResult = { statuses: {}, latenciesMs: [], holds: [] };
  const body = JSON.stringify({
    service_id: options.serviceId,
    location_id: options.locationId,
    start_at: options.startAt,
  });
  // Все запросы стартуют вместе: промисы создаются до первого await
  const attempts = Array.from({ length: options.n }, async () => {
    const started = performance.now();
    const res = await fetch(new URL('/v1/public/holds', options.api), {
      method: 'POST',
      headers: headersOf(options),
      body,
    });
    result.latenciesMs.push(performance.now() - started);
    result.statuses[res.status] = (result.statuses[res.status] ?? 0) + 1;
    if (res.status === 201) result.holds.push((await res.json()) as RaceResult['holds'][number]);
    else await res.body?.cancel();
  });
  await Promise.all(attempts);
  return result;
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

export function summarize(result: RaceResult): string {
  const statuses = Object.entries(result.statuses)
    .map(([status, count]) => `${status}×${count}`)
    .join(', ');
  const ms = (p: number) => `${Math.round(percentile(result.latenciesMs, p))} ms`;
  return `holds: ${result.holds.length}; statuses: ${statuses}; p50 ${ms(50)}, p95 ${ms(95)}, max ${ms(100)}`;
}

async function firstFreeSlot(options: Omit<RaceOptions, 'startAt' | 'n'>): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
  const query = new URLSearchParams({
    service_id: options.serviceId,
    location_id: options.locationId,
    from: today,
    to: until,
  });
  const res = await fetch(new URL(`/v1/public/availability?${query}`, options.api), {
    headers: headersOf({ ...options, startAt: '', n: 0 }),
  });
  if (!res.ok) throw new Error(`availability: HTTP ${res.status}`);
  const data = (await res.json()) as PublicAvailability;
  const slot = data.days.flatMap((d) => d.slots)[0];
  if (!slot) throw new Error('no free slot in the next two weeks');
  return slot;
}

async function main() {
  const { values } = parseArgs({
    options: {
      api: { type: 'string' },
      key: { type: 'string' },
      origin: { type: 'string' },
      service: { type: 'string' },
      location: { type: 'string' },
      start: { type: 'string' },
      n: { type: 'string', default: '50' },
    },
  });
  const { api, key, origin, service, location } = values;
  if (!api || !key || !origin || !service || !location) {
    throw new Error('Required: --api --key --origin --service --location');
  }
  const base = { api, key, origin, serviceId: service, locationId: location };
  const startAt = values.start ?? (await firstFreeSlot(base));
  const result = await raceHolds({ ...base, startAt, n: Number(values.n) });
  process.stdout.write(`slot ${startAt}: ${summarize(result)}\n`);
  for (const hold of result.holds) {
    await fetch(new URL(`/v1/public/holds/${hold.hold_id}`, api), {
      method: 'DELETE',
      headers: headersOf({ ...base, startAt, n: 0 }),
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
