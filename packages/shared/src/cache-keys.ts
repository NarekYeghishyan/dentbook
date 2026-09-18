/**
 * Ключи кеша слотов в Redis (CLAUDE.md §6) — общие для API, который кеширует, и worker'а,
 * который сбрасывает кеш после снятия холдов. Формат §6 плюс филиал в конце (ADR-0008).
 */
export const slotCacheKey = (k: {
  clinicId: string;
  dentistId: string;
  date: string;
  serviceId: string;
  locationId: string;
}) => `avail:${k.clinicId}:${k.dentistId}:${k.date}:${k.serviceId}:${k.locationId}`;

/** Все слоты врача — для SCAN MATCH при сбросе. */
export const dentistSlotsPattern = (clinicId: string, dentistId: string) =>
  `avail:${clinicId}:${dentistId}:*`;

/** Все слоты клиники. */
export const clinicSlotsPattern = (clinicId: string) => `avail:${clinicId}:*`;
