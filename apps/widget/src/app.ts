/**
 * Форма записи (Шаг 6): услуга → офис → день и время → данные → SMS-код → готово.
 * Экран перерисовывается целиком при смене шага; ввод в поля пишется в состояние без
 * перерисовки, чтобы не терять фокус.
 */
import type {
  ConfirmedAppointment,
  HoldResponse,
  PublicAvailability,
  PublicConfig,
  PublicLocation,
  PublicService,
  VerificationResponse,
} from '@dentbook/shared';
import type { Locale } from '@dentbook/shared/domain';
import { toE164 } from '@dentbook/shared/phone';
import { createApi, WidgetApiError } from './api';
import { renderCaptcha, type Captcha } from './captcha';
import { addDays, formatDateOf, formatDay, formatTime, todayIn } from './dates';
import { translator, type MessageKey } from './i18n';
import { css } from './styles';

export interface WidgetOptions {
  key: string;
  /** Адрес API, по умолчанию — origin скрипта. */
  apiBase: string;
  /** Язык формы; по умолчанию — язык из настроек клиники. */
  locale?: Locale | undefined;
}

type Step = 'loading' | 'unavailable' | 'service' | 'office' | 'time' | 'details' | 'code' | 'done';

/** Сколько дней показывать за раз. */
const WINDOW_DAYS = 14;

type Child = Node | string | false | null | undefined;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      el.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    } else if (name === 'class') {
      el.className = String(value);
    } else if (name in el) {
      Reflect.set(el, name, value);
    } else {
      el.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child !== false && child !== null && child !== undefined) el.append(child);
  }
  return el;
}

const ERROR_TEXT: Partial<Record<string, MessageKey>> = {
  slot_taken: 'error.slot_taken',
  hold_expired: 'error.hold_expired',
  verification_failed: 'error.verification_failed',
  verification_required: 'error.verification_required',
  rate_limited: 'error.rate_limited',
  invalid_key: 'error.unavailable',
  origin_not_allowed: 'error.unavailable',
};

export function mountWidget(host: HTMLElement, options: WidgetOptions): void {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const view = h('div', { class: 'db', part: 'form' });
  shadow.replaceChildren(h('style', {}, css), view);
  const api = createApi(options.apiBase, options.key);

  let locale: Locale = options.locale ?? 'en';
  let t = translator(locale);

  const s = {
    step: 'loading' as Step,
    config: undefined as PublicConfig | undefined,
    services: [] as PublicService[],
    service: undefined as PublicService | undefined,
    location: undefined as PublicLocation | undefined,
    from: '',
    days: [] as PublicAvailability['days'],
    date: undefined as string | undefined,
    alternatives: [] as string[],
    hold: undefined as HoldResponse | undefined,
    form: { name: '', phone: '', email: '', notes: '' },
    phone: '',
    verificationId: '',
    code: '',
    appointment: undefined as ConfirmedAppointment | undefined,
    cancelled: false,
    error: undefined as MessageKey | undefined,
    busy: false,
  };

  // Капча живёт, пока держится слот: перерисовка шага не сбрасывает пройденную проверку
  let captcha: Captcha | undefined;
  let captchaBox: HTMLElement | undefined;
  let countdown: ReturnType<typeof setInterval> | undefined;

  const zone = () => s.location?.time_zone ?? 'UTC';

  function show(step: Step, patch: Partial<typeof s> = {}) {
    Object.assign(s, { error: undefined, ...patch, step });
    render();
  }

  function fail(error: unknown) {
    // 503 — у клиники не настроены SMS: записаться онлайн сейчас нельзя
    const key: MessageKey =
      error instanceof WidgetApiError
        ? error.status === 503
          ? 'error.unavailable'
          : (ERROR_TEXT[error.code] ?? 'error.generic')
        : 'error.generic';
    s.busy = false;
    s.error = key;
    render();
  }

  /** Запрос с блокировкой кнопок на время ожидания. */
  async function run(action: () => Promise<void>) {
    if (s.busy) return;
    s.busy = true;
    render();
    try {
      await action();
    } catch (error) {
      fail(error);
      return;
    }
    s.busy = false;
    render();
  }

  // --- действия ---

  async function start() {
    try {
      const [config, services] = await Promise.all([
        api.get<PublicConfig>('/config'),
        api.get<PublicService[]>('/services'),
      ]);
      if (!options.locale) {
        locale = config.clinic.locale;
        t = translator(locale);
      }
      const primary = config.theme.primary_color;
      if (typeof primary === 'string' && /^#[0-9a-f]{3,8}$/i.test(primary)) {
        view.style.setProperty('--db-primary', primary);
      }
      s.config = config;
      s.services = services;
      show(services.length > 0 && config.locations.length > 0 ? 'service' : 'unavailable');
    } catch {
      show('unavailable');
    }
  }

  function chooseService(service: PublicService) {
    s.service = service;
    const offices = s.config!.locations;
    if (offices.length === 1) void chooseOffice(offices[0]!);
    else show('office');
  }

  function chooseOffice(location: PublicLocation) {
    s.location = location;
    return loadDays(todayIn(location.time_zone));
  }

  async function loadDays(from: string, keepDate = false) {
    const to = addDays(from, WINDOW_DAYS - 1);
    await run(async () => {
      const result = await api.get<PublicAvailability>(
        `/availability?service_id=${s.service!.id}&location_id=${s.location!.id}&from=${from}&to=${to}`,
      );
      const firstFree = result.days.find((d) => d.slots.length > 0)?.date;
      Object.assign(s, {
        from,
        days: result.days,
        date: keepDate && s.date ? s.date : firstFree,
        step: 'time',
      });
    });
  }

  function stopCountdown() {
    if (countdown !== undefined) clearInterval(countdown);
    countdown = undefined;
  }

  function startCountdown(label: HTMLElement) {
    stopCountdown();
    const tick = () => {
      const left = Math.max(0, Date.parse(s.hold!.expires_at) - Date.now());
      const min = Math.floor(left / 60_000);
      const sec = Math.floor((left % 60_000) / 1000);
      label.textContent = t('details.reserved', { time: `${min}:${String(sec).padStart(2, '0')}` });
      if (left === 0) void backToTime('error.hold_expired');
    };
    tick();
    countdown = setInterval(tick, 1000);
  }

  async function holdSlot(startAt: string) {
    s.alternatives = [];
    await run(async () => {
      try {
        s.hold = await api.post<HoldResponse>('/holds', {
          service_id: s.service!.id,
          location_id: s.location!.id,
          start_at: startAt,
        });
        s.step = 'details';
      } catch (error) {
        if (error instanceof WidgetApiError && error.code === 'slot_taken') {
          s.alternatives = (error.body?.alternatives as string[] | undefined) ?? [];
          s.days = s.days.map((d) => ({ ...d, slots: d.slots.filter((x) => x !== startAt) }));
        }
        throw error;
      }
    });
  }

  function dropCaptcha() {
    captcha = undefined;
    captchaBox = undefined;
  }

  function releaseHold() {
    stopCountdown();
    dropCaptcha();
    if (s.hold) void api.del(`/holds/${s.hold.hold_id}`).catch(() => undefined);
    s.hold = undefined;
  }

  /**
   * Холда больше нет (клиент вернулся, время вышло или сервер ответил hold_expired):
   * сначала уйти с шагов, которым нужен холд, потом перечитать свободное время.
   */
  async function backToTime(error?: MessageKey) {
    releaseHold();
    s.step = 'time';
    s.busy = false;
    await loadDays(s.from, true);
    if (error) {
      s.error = error;
      render();
    }
  }

  async function sendCode() {
    const phone = toE164(s.form.phone);
    if (!s.form.name.trim()) return show('details', { error: 'error.name' });
    if (!phone) return show('details', { error: 'error.phone' });
    const captchaToken = captcha?.token();
    if (captcha && !captchaToken) return show('details', { error: 'error.captcha' });
    await run(async () => {
      try {
        const verification = await api.post<VerificationResponse>('/verifications', {
          phone,
          locale,
          ...(captchaToken ? { captcha_token: captchaToken } : {}),
        });
        Object.assign(s, {
          phone,
          verificationId: verification.verification_id,
          code: '',
          step: 'code',
        });
      } finally {
        captcha?.reset();
      }
    });
  }

  async function confirm() {
    let expired = false;
    await run(async () => {
      try {
        s.appointment = await api.post<ConfirmedAppointment>('/appointments', {
          hold_id: s.hold!.hold_id,
          verification_id: s.verificationId,
          code: s.code.trim(),
          client: {
            full_name: s.form.name.trim(),
            phone: s.phone,
            ...(s.form.email.trim() ? { email: s.form.email.trim() } : {}),
          },
          ...(s.form.notes.trim() ? { notes: s.form.notes.trim() } : {}),
        });
        stopCountdown();
        dropCaptcha();
        s.hold = undefined;
        s.step = 'done';
      } catch (error) {
        if (error instanceof WidgetApiError && error.code === 'hold_expired') {
          expired = true;
          return;
        }
        throw error;
      }
    });
    if (expired) await backToTime('error.hold_expired');
  }

  async function cancel() {
    if (!window.confirm(t('done.cancelConfirm'))) return;
    const { id, token } = s.appointment!;
    await run(async () => {
      await api.post(`/appointments/${id}/cancel`, { token });
      s.cancelled = true;
    });
  }

  function restart() {
    show('service', {
      service: undefined,
      location: undefined,
      appointment: undefined,
      cancelled: false,
      alternatives: [],
      form: { ...s.form, notes: '' },
    });
  }

  // --- экраны ---

  const back = (onClick: () => void) =>
    h('button', { type: 'button', class: 'link', onclick: onClick }, `← ${t('back')}`);

  const header = (title: MessageKey, onBack?: () => void) =>
    h('div', { class: 'bar' }, h('h2', {}, t(title)), onBack && back(onBack));

  const price = (service: PublicService) =>
    service.price === null
      ? ''
      : new Intl.NumberFormat(locale, { style: 'currency', currency: service.currency }).format(
          Number(service.price),
        );

  function field(
    label: string,
    name: keyof typeof s.form,
    attrs: Record<string, unknown> = {},
    multiline = false,
  ) {
    const control = h(multiline ? 'textarea' : 'input', {
      value: s.form[name],
      oninput: (e: Event) => (s.form[name] = (e.target as HTMLInputElement).value),
      ...attrs,
    });
    return h('label', {}, label, control);
  }

  function screen(): Child[] {
    const error = s.error && h('div', { class: 'error', role: 'alert' }, t(s.error));
    switch (s.step) {
      case 'loading':
        return [h('p', { class: 'muted' }, t('loading'))];

      case 'unavailable':
        return [h('p', {}, t('error.unavailable'))];

      case 'service':
        return [
          h('h2', {}, t('service.title')),
          error,
          h(
            'div',
            { class: 'list' },
            ...s.services.map((service) =>
              h(
                'button',
                { type: 'button', class: 'item', onclick: () => chooseService(service) },
                h(
                  'span',
                  {},
                  service.name,
                  h('small', {}, t('service.minutes', { min: service.duration_min })),
                ),
                h('span', {}, price(service)),
              ),
            ),
          ),
        ];

      case 'office':
        return [
          header('office.title', () => show('service')),
          error,
          h(
            'div',
            { class: 'list' },
            ...s.config!.locations.map((office) =>
              h(
                'button',
                { type: 'button', class: 'item', onclick: () => void chooseOffice(office) },
                h('span', {}, office.name, office.address && h('small', {}, office.address)),
              ),
            ),
          ),
        ];

      case 'time': {
        const today = todayIn(zone());
        const day = s.days.find((d) => d.date === s.date);
        const anyFree = s.days.some((d) => d.slots.length > 0);
        return [
          header('time.title', () =>
            s.config!.locations.length > 1 ? show('office') : show('service'),
          ),
          error,
          s.alternatives.length > 0 &&
            h(
              'div',
              { class: 'note' },
              t('time.taken'),
              h(
                'div',
                { class: 'slots', style: 'margin-top:8px' },
                ...s.alternatives.map((slot) =>
                  h(
                    'button',
                    { type: 'button', class: 'slot', onclick: () => void holdSlot(slot) },
                    formatTime(slot, zone(), locale),
                  ),
                ),
              ),
            ),
          h(
            'div',
            { class: 'days', role: 'group' },
            ...s.days.map((d) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'day',
                  disabled: d.slots.length === 0,
                  'aria-pressed': String(d.date === s.date),
                  onclick: () => show('time', { date: d.date, alternatives: [] }),
                },
                formatDay(d.date, locale),
              ),
            ),
          ),
          !anyFree
            ? h('p', { class: 'muted' }, t('time.noneAll'))
            : day && day.slots.length > 0
              ? h(
                  'div',
                  { class: 'slots' },
                  ...day.slots.map((slot) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'slot',
                        disabled: s.busy,
                        onclick: () => void holdSlot(slot),
                      },
                      formatTime(slot, zone(), locale),
                    ),
                  ),
                )
              : h('p', { class: 'muted' }, t('time.none')),
          h(
            'div',
            { class: 'nav' },
            h(
              'button',
              {
                type: 'button',
                class: 'link',
                disabled: s.from <= today || s.busy,
                onclick: () => void loadDays(addDays(s.from, -WINDOW_DAYS)),
              },
              `← ${t('time.earlier')}`,
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'link',
                disabled: s.busy,
                onclick: () => void loadDays(addDays(s.from, WINDOW_DAYS)),
              },
              `${t('time.later')} →`,
            ),
          ),
        ];
      }

      case 'details': {
        const reserved = h('div', { class: 'note', 'aria-live': 'polite' });
        startCountdown(reserved);
        const siteKey = s.config!.captcha?.site_key;
        if (siteKey && !captchaBox) {
          captchaBox = h('div', { class: 'captcha' });
          captcha = renderCaptcha(captchaBox, siteKey, locale);
        }
        return [
          header('details.title', () => void backToTime()),
          h(
            'p',
            {},
            h(
              'strong',
              {},
              `${formatDateOf(s.hold!.start_at, zone(), locale)}, ${formatTime(s.hold!.start_at, zone(), locale)}`,
            ),
            h('br'),
            h('span', { class: 'muted' }, `${s.service!.name} · ${s.location!.name}`),
          ),
          reserved,
          error,
          h(
            'form',
            {
              novalidate: true,
              onsubmit: (e: Event) => {
                e.preventDefault();
                void sendCode();
              },
            },
            field(t('details.name'), 'name', { autocomplete: 'name', required: true }),
            field(t('details.phone'), 'phone', {
              type: 'tel',
              autocomplete: 'tel',
              inputMode: 'tel',
              placeholder: '(202) 555-0123',
              required: true,
            }),
            h('p', { class: 'muted' }, t('details.phoneHint')),
            field(t('details.email'), 'email', { type: 'email', autocomplete: 'email' }),
            field(t('details.notes'), 'notes', { rows: 2 }, true),
            captchaBox,
            h(
              'button',
              { type: 'submit', class: 'btn wide', disabled: s.busy },
              t('details.submit'),
            ),
          ),
        ];
      }

      case 'code': {
        const reserved = h('div', { class: 'note', 'aria-live': 'polite' });
        startCountdown(reserved);
        return [
          header('code.title', () => show('details')),
          h('p', {}, t('code.sent', { phone: s.phone })),
          reserved,
          error,
          h(
            'form',
            {
              onsubmit: (e: Event) => {
                e.preventDefault();
                void confirm();
              },
            },
            h(
              'label',
              {},
              t('code.label'),
              h('input', {
                class: 'code',
                value: s.code,
                inputMode: 'numeric',
                autocomplete: 'one-time-code',
                maxLength: 6,
                pattern: '\\d{6}',
                required: true,
                oninput: (e: Event) => (s.code = (e.target as HTMLInputElement).value),
              }),
            ),
            h('button', { type: 'submit', class: 'btn wide', disabled: s.busy }, t('code.submit')),
          ),
          h(
            'div',
            { class: 'nav' },
            h(
              'button',
              { type: 'button', class: 'link', onclick: () => show('details') },
              t('code.change'),
            ),
          ),
        ];
      }

      case 'done': {
        const a = s.appointment!;
        return [
          h(
            'div',
            { class: 'done' },
            h('div', { class: 'mark', 'aria-hidden': 'true' }, s.cancelled ? '×' : '✓'),
            h('h2', {}, s.cancelled ? t('done.cancelled') : t('done.title')),
            !s.cancelled && a.status === 'pending' && h('p', {}, t('done.pending')),
            h(
              'p',
              {},
              h(
                'strong',
                {},
                `${formatDateOf(a.start_at, a.time_zone, locale)}, ${formatTime(a.start_at, a.time_zone, locale)}`,
              ),
              h('br'),
              `${a.service.name} · ${a.location.name}`,
              a.location.address && h('br'),
              a.location.address,
              h('br'),
              t('done.with', { name: a.dentist.full_name }),
            ),
            error,
            !s.cancelled &&
              h(
                'button',
                { type: 'button', class: 'link', disabled: s.busy, onclick: () => void cancel() },
                t('done.cancel'),
              ),
            h('p', {}),
            h('button', { type: 'button', class: 'btn', onclick: restart }, t('done.again')),
          ),
        ];
      }
    }
  }

  function render() {
    stopCountdown();
    view.replaceChildren(...screen().filter((c): c is Node | string => Boolean(c)));
  }

  render();
  void start();
}
