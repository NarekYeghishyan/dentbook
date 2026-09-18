/**
 * Отправка SMS. Реальный провайдер подключается на Шаге 6 (Q5: клиенты в США); пока его
 * нет, POST /verifications отвечает 503. Тестовые реализации живут в тестах (§12).
 */
export interface SmsSender {
  /** to — E.164. Текст не логируется: в нём код и имя клиники (§2.6). */
  send(message: { to: string; text: string }): Promise<void>;
}
