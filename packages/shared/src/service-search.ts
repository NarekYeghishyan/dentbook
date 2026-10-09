/**
 * Поиск и группировка услуг для списков выбора (админка, Mini App, виджет): один и тот же
 * порядок и одни и те же правила совпадения везде.
 */

/** Ключ для поиска: без регистра и диакритики — «Türkiye» находится и по «turkiye». */
export const foldText = (value: string): string =>
  value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface ServiceGroup<T> {
  /** null — услуги без категории: идут в конце. */
  category: string | null;
  items: T[];
}

/**
 * Услуги, подходящие под запрос, по категориям. Запрос — слова через пробел: каждое должно
 * встретиться в названии или категории («root molar» находит «Root canal – molar»).
 * Порядок категорий — по первой услуге в переданном списке (он уже отсортирован), порядок
 * услуг внутри категории сохраняется.
 */
export function groupServices<T extends { name: string; category: string | null }>(
  items: readonly T[],
  query: string,
): ServiceGroup<T>[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const haystack = foldText(`${item.name} ${item.category ?? ''}`);
    if (!words.every((word) => haystack.includes(word))) continue;
    const list = groups.get(item.category);
    if (list) list.push(item);
    else groups.set(item.category, [item]);
  }
  const named = [...groups].filter(([category]) => category !== null);
  const rest = groups.get(null);
  return [
    ...named.map(([category, list]) => ({ category, items: list })),
    ...(rest ? [{ category: null, items: rest }] : []),
  ];
}

/** Цена услуги для показа: '120.00' → '$120' (без копеек, если их нет). */
export function formatPrice(value: string, currency: string, locale: string): string {
  const amount = Number(value);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
