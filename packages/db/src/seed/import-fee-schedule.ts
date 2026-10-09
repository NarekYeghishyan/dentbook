import { and, eq, max } from 'drizzle-orm';
import type { Database } from '../client.js';
import { services } from '../schema/index.js';
import { FEE_SCHEDULE, FEE_SCHEDULE_DURATION_MIN } from './fee-schedule.js';

export interface FeeScheduleImportResult {
  created: number;
  /** Услуга с таким названием уже была: пустые категория и Insurance Fee заполнены. */
  existing: number;
}

/**
 * Загружает каталог из FEE_SCHEDULE в клинику. Запускать можно повторно: услуга с тем же
 * названием (без учёта регистра) не создаётся второй раз, её цена, длительность и видимость
 * не трогаются (Insurance Fee заполняется, только если он пуст) — клиника могла их поправить. Порядок услуг (sort_order) идёт за уже
 * заведёнными и повторяет прайс, поэтому категории в списках выбора идут подряд.
 *
 * По умолчанию услуги скрыты из формы записи (isPublic: false): длительности здесь
 * общие и подставные, пациенты не должны записываться по ним, пока клиника их не проверит.
 */
export async function importFeeSchedule(
  db: Database,
  clinicId: string,
  options: { isPublic?: boolean } = {},
): Promise<FeeScheduleImportResult> {
  const isPublic = options.isPublic ?? false;
  const result: FeeScheduleImportResult = { created: 0, existing: 0 };

  await db.transaction(async (tx) => {
    const known = await tx
      .select({
        id: services.id,
        name: services.name,
        category: services.category,
        insurancePrice: services.insurancePrice,
      })
      .from(services)
      .where(eq(services.clinicId, clinicId));
    const byName = new Map(known.map((s) => [s.name.toLowerCase(), s]));
    const [row] = await tx
      .select({ last: max(services.sortOrder) })
      .from(services)
      .where(eq(services.clinicId, clinicId));
    let sortOrder = (row?.last ?? 0) + 1;

    for (const { category, services: rows } of FEE_SCHEDULE) {
      for (const [name, cashFrom, insuranceFrom] of rows) {
        const found = byName.get(name.toLowerCase());
        if (found) {
          result.existing += 1;
          // Только пустые поля: цену и категорию клиника могла поправить
          const fill = {
            ...(found.category === null ? { category } : {}),
            ...(found.insurancePrice === null ? { insurancePrice: insuranceFrom.toFixed(2) } : {}),
          };
          if (Object.keys(fill).length > 0) {
            await tx
              .update(services)
              .set(fill)
              .where(and(eq(services.clinicId, clinicId), eq(services.id, found.id)));
          }
          continue;
        }
        await tx.insert(services).values({
          clinicId,
          name,
          category,
          durationMin: FEE_SCHEDULE_DURATION_MIN,
          price: cashFrom.toFixed(2),
          insurancePrice: insuranceFrom.toFixed(2),
          isPublic,
          sortOrder,
        });
        sortOrder += 1;
        result.created += 1;
      }
    }
  });
  return result;
}
