/**
 * Отправка SMS. Провайдер выбирается переменными окружения (providers.ts); без него
 * POST /verifications отвечает 503. Тестовые реализации живут в тестах (§12).
 */
export interface SmsSender {
  /** to — E.164. Текст не логируется: в нём код и имя клиники (§2.6). */
  send(message: { to: string; text: string }): Promise<void>;
}
