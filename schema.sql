-- =============================================================================
-- DentBook — опорная схема БД (CLAUDE.md §5). PostgreSQL 16.
--
-- Файл — справочник, а не миграция: в БД руками не применяется (CLAUDE.md §9).
-- Схема переносится в Drizzle (packages/db/src/schema) без изменения имён,
-- миграции генерирует drizzle-kit. То, что DSL Drizzle не выражает
-- (расширения, EXCLUDE, gist-индексы по выражению), идёт кастомной миграцией
-- `drizzle-kit generate --custom` — её тоже применяет drizzle-kit.
--
-- Соглашения (подробно — docs/adr/0003-schema-design.md):
--   * первичные ключи — uuid, gen_random_uuid();
--   * моменты времени — timestamptz, UTC (§2.3). Исключение — working_hours:
--     там настенное время (time) в поясе филиала, см. комментарий к таблице;
--   * деньги — numeric(12,2) (§9);
--   * перечисления — text + CHECK, а не enum-типы: их проще расширять;
--   * тенантность (§2.2): у каждой таблицы данных есть clinic_id, ссылки между
--     сущностями — составные FK (clinic_id, x_id). БД не даст связать запись
--     одной клиники с врачом, услугой или клиентом другой;
--   * updated_at выставляет приложение (Drizzle $onUpdate), триггеров нет;
--   * FK без каскада (NO ACTION): клинику, врача, услугу с записями удалить
--     нельзя — их деактивируют. Каскад только у связующих и служебных таблиц;
--   * имена в БД: patients, clinics, locations. В интерфейсе — client, clinic,
--     office (§5).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;


-- -----------------------------------------------------------------------------
-- clinics — тенант платформы
-- -----------------------------------------------------------------------------
CREATE TABLE clinics (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  -- IANA, напр. 'Asia/Yerevan'. Корректность проверяет zod-схема (Intl):
  -- CHECK не умеет сверять с базой часовых поясов.
  timezone          text        NOT NULL,
  locale            text        NOT NULL DEFAULT 'en',
  currency          char(3)     NOT NULL,
  -- Настройки записи (§6). Значения по умолчанию — предложение из Q4.
  min_lead_min      integer     NOT NULL DEFAULT 120,  -- notBefore = now + min_lead_min
  slot_step_min     integer     NOT NULL DEFAULT 15,   -- stepMin
  max_advance_days  integer     NOT NULL DEFAULT 60,   -- насколько вперёд можно записаться
  -- Цвета и оформление виджета для GET /v1/public/config
  widget_theme      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status            text        NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT clinics_locale_format    CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT clinics_currency_format  CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT clinics_min_lead_min     CHECK (min_lead_min >= 0),
  CONSTRAINT clinics_slot_step_min    CHECK (slot_step_min > 0),
  CONSTRAINT clinics_max_advance_days CHECK (max_advance_days > 0),
  CONSTRAINT clinics_status           CHECK (status IN ('active', 'suspended'))
);


-- -----------------------------------------------------------------------------
-- locations — филиалы клиники. В интерфейсе: «office».
-- -----------------------------------------------------------------------------
CREATE TABLE locations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid        NOT NULL REFERENCES clinics (id),
  name        text        NOT NULL,
  address     text,
  phone       text,
  -- NULL — используется пояс клиники (§2.3)
  timezone    text,
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT locations_clinic_id_id_key UNIQUE (clinic_id, id)
);


-- -----------------------------------------------------------------------------
-- users — сотрудники клиник и операторы платформы (вход в админку, §7 JWT).
-- Врачи — отдельная сущность: они работают через Telegram, учётка им не нужна.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL только у оператора платформы (панель оператора, Шаг 10)
  clinic_id      uuid        REFERENCES clinics (id),
  email          citext      NOT NULL,
  password_hash  text        NOT NULL,
  full_name      text        NOT NULL,
  -- owner — зарегистрировал клинику; admin — полный CRUD;
  -- registrar — регистратура: записи и клиенты; operator — платформа
  role           text        NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- TODO: email уникален на всю платформу — один человек не может состоять
  -- в двух клиниках. Так проще вход; пересмотреть по запросу (Q9).
  CONSTRAINT users_email_key               UNIQUE (email),
  CONSTRAINT users_role                    CHECK (role IN ('owner', 'admin', 'registrar', 'operator')),
  CONSTRAINT users_operator_has_no_clinic  CHECK ((role = 'operator') = (clinic_id IS NULL))
);

CREATE INDEX users_clinic_idx ON users (clinic_id);


-- -----------------------------------------------------------------------------
-- api_keys — публикуемые ключи pk_* для виджета (§2.5, §7)
-- -----------------------------------------------------------------------------
CREATE TABLE api_keys (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid        NOT NULL REFERENCES clinics (id),
  name             text        NOT NULL,
  -- Ключ по природе публичный (лежит в HTML сайта клиники), поэтому хранится
  -- открыто: админке нужно повторно показать его в коде встраивания.
  token            text        NOT NULL,
  -- Пустой массив — запрещены все Origin (§2.5: нет совпадения → 403)
  allowed_origins  text[]      NOT NULL DEFAULT '{}',
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  created_by       uuid        REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT api_keys_token_key     UNIQUE (token),
  CONSTRAINT api_keys_token_prefix  CHECK (token LIKE 'pk\_%')
);

CREATE INDEX api_keys_clinic_idx ON api_keys (clinic_id);


-- -----------------------------------------------------------------------------
-- dentists — врачи
-- -----------------------------------------------------------------------------
CREATE TABLE dentists (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid        NOT NULL REFERENCES clinics (id),
  full_name           text        NOT NULL,
  -- Меньше — выше приоритет при автоназначении (§6). Порядок задаётся
  -- перетаскиванием в админке (Шаг 4).
  priority            integer     NOT NULL DEFAULT 100,
  is_active           boolean     NOT NULL DEFAULT true,
  -- Telegram (§8). В личном чате chat_id = user.id — по нему Mini App находит врача.
  telegram_chat_id    bigint,
  telegram_blocked    boolean     NOT NULL DEFAULT false,
  telegram_linked_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dentists_clinic_id_id_key UNIQUE (clinic_id, id),
  -- TODO: один Telegram-аккаунт = один врач на платформе. Врачу, работающему
  -- в двух клиниках, понадобится выбор клиники в боте (Q9).
  CONSTRAINT dentists_telegram_chat_id_key UNIQUE (telegram_chat_id)
);

CREATE INDEX dentists_clinic_priority_idx ON dentists (clinic_id, priority);


-- -----------------------------------------------------------------------------
-- services — услуги
-- -----------------------------------------------------------------------------
CREATE TABLE services (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid          NOT NULL REFERENCES clinics (id),
  name          text          NOT NULL,
  description   text,
  duration_min  integer       NOT NULL,
  buffer_min    integer       NOT NULL DEFAULT 0,
  -- NULL — цена в виджете не показывается. Валюта — clinics.currency.
  price         numeric(12,2),
  -- Попадает в GET /v1/public/services (§7)
  is_public     boolean       NOT NULL DEFAULT true,
  is_active     boolean       NOT NULL DEFAULT true,
  sort_order    integer       NOT NULL DEFAULT 0,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT services_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT services_duration_min     CHECK (duration_min > 0),
  CONSTRAINT services_buffer_min       CHECK (buffer_min >= 0),
  CONSTRAINT services_price            CHECK (price IS NULL OR price >= 0)
);


-- -----------------------------------------------------------------------------
-- dentist_services — какие услуги оказывает врач
-- (§6: «любой врач» = все врачи, оказывающие услугу)
-- -----------------------------------------------------------------------------
CREATE TABLE dentist_services (
  clinic_id   uuid NOT NULL REFERENCES clinics (id),
  dentist_id  uuid NOT NULL,
  service_id  uuid NOT NULL,

  PRIMARY KEY (dentist_id, service_id),
  CONSTRAINT dentist_services_dentist_fk FOREIGN KEY (clinic_id, dentist_id)
    REFERENCES dentists (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT dentist_services_service_fk FOREIGN KEY (clinic_id, service_id)
    REFERENCES services (clinic_id, id) ON DELETE CASCADE
);

CREATE INDEX dentist_services_service_idx ON dentist_services (clinic_id, service_id);


-- -----------------------------------------------------------------------------
-- resources — кабинеты, кресла, оборудование филиала.
-- CLAUDE.md называет сущность, но не описывает, как она влияет на доступность:
-- движок §6 ресурсы не учитывает. Пока — справочник без связи с записями.
-- TODO: связь с услугами и записями — после ответа на Q10.
-- -----------------------------------------------------------------------------
CREATE TABLE resources (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid        NOT NULL REFERENCES clinics (id),
  location_id  uuid        NOT NULL,
  name         text        NOT NULL,
  kind         text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT resources_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT resources_kind             CHECK (kind IN ('room', 'chair', 'equipment')),
  CONSTRAINT resources_location_fk      FOREIGN KEY (clinic_id, location_id)
    REFERENCES locations (clinic_id, id)
);


-- -----------------------------------------------------------------------------
-- working_hours — недельный шаблон рабочего времени врача в филиале.
--
-- Время настенное, в поясе филиала (или клиники): «9:00–18:00» остаётся 9:00
-- и зимой, и летом, а UTC-смещение меняется. Поэтому здесь time, а не
-- timestamptz. Перевод в UTC-интервалы на конкретную дату — в коде, до вызова
-- computeSlots (§6); этот перевод покрывается тестами на DST.
--
-- end_time <= start_time — смена через полночь, заканчивается на следующий день.
-- weekday — день начала смены.
-- -----------------------------------------------------------------------------
CREATE TABLE working_hours (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid        NOT NULL REFERENCES clinics (id),
  dentist_id   uuid        NOT NULL,
  location_id  uuid        NOT NULL,
  -- ISO 8601: 1 — понедельник … 7 — воскресенье
  weekday      smallint    NOT NULL,
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT working_hours_weekday     CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT working_hours_not_empty   CHECK (start_time <> end_time),
  CONSTRAINT working_hours_dentist_fk  FOREIGN KEY (clinic_id, dentist_id)
    REFERENCES dentists (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT working_hours_location_fk FOREIGN KEY (clinic_id, location_id)
    REFERENCES locations (clinic_id, id)
);

CREATE INDEX working_hours_dentist_idx ON working_hours (dentist_id, weekday);


-- -----------------------------------------------------------------------------
-- schedule_exceptions — разовые изменения расписания (§6):
--   block — закрыть время, extra — добавить время сверх шаблона.
--
-- Правило §8: врач не может закрыть время, на котором есть запись. Проверка —
-- в коде: ей нужно вернуть список конфликтующих записей.
-- TODO (Шаг 7): проверку и вставку block выполнять под advisory-lock на врача —
-- тем же, что берёт создание записи. Иначе гонка «block ↔ новая запись».
-- -----------------------------------------------------------------------------
CREATE TABLE schedule_exceptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid        NOT NULL REFERENCES clinics (id),
  dentist_id   uuid        NOT NULL,
  -- Для extra обязателен: дополнительное время проходит в конкретном филиале
  location_id  uuid,
  type         text        NOT NULL,
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  reason       text,
  -- NULL — создано врачом через Telegram
  created_by   uuid        REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT schedule_exceptions_type            CHECK (type IN ('block', 'extra')),
  CONSTRAINT schedule_exceptions_range           CHECK (end_at > start_at),
  CONSTRAINT schedule_exceptions_extra_location  CHECK (type = 'block' OR location_id IS NOT NULL),
  CONSTRAINT schedule_exceptions_dentist_fk      FOREIGN KEY (clinic_id, dentist_id)
    REFERENCES dentists (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT schedule_exceptions_location_fk     FOREIGN KEY (clinic_id, location_id)
    REFERENCES locations (clinic_id, id)
);

CREATE INDEX schedule_exceptions_dentist_range_idx
  ON schedule_exceptions USING gist (dentist_id, tstzrange(start_at, end_at));


-- -----------------------------------------------------------------------------
-- patients — клиенты клиники. В интерфейсе: «client» (§5).
-- ПДн хранятся здесь и никогда не попадают в логи и трекеры ошибок (§2.6).
-- -----------------------------------------------------------------------------
CREATE TABLE patients (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid        NOT NULL REFERENCES clinics (id),
  full_name          text        NOT NULL,
  -- E.164, напр. +37491234567
  phone              text        NOT NULL,
  email              citext,
  phone_verified_at  timestamptz,
  -- Заметки регистратуры для карточки клиента (Шаг 9)
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT patients_clinic_id_id_key  UNIQUE (clinic_id, id),
  -- Клиент в клинике определяется телефоном: его же подтверждает SMS-код
  CONSTRAINT patients_clinic_phone_key  UNIQUE (clinic_id, phone),
  CONSTRAINT patients_phone_e164        CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')
);


-- -----------------------------------------------------------------------------
-- appointments — записи.
--
-- Холд (§7 POST /holds) — тоже строка этой таблицы со status = 'hold'.
-- Только так EXCLUDE-ограничение защищает удерживаемый слот. hold_id — это
-- appointments.id; POST /appointments переводит строку hold → pending/confirmed.
-- Холд, снятый по DELETE /holds/:id или по таймауту, получает status = 'expired'.
--
-- Жизненный цикл:
--   hold → pending → confirmed → completed | no_show
--   hold → expired
--   pending | confirmed → cancelled
-- -----------------------------------------------------------------------------
CREATE TABLE appointments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid        NOT NULL REFERENCES clinics (id),
  location_id      uuid        NOT NULL,
  dentist_id       uuid        NOT NULL,
  service_id       uuid        NOT NULL,
  -- NULL, пока запись — холд: данные клиента приходят при подтверждении
  patient_id       uuid,
  start_at         timestamptz NOT NULL,
  end_at           timestamptz NOT NULL,
  -- Снимок services.buffer_min на момент записи (§6): правка услуги не сдвигает
  -- уже существующие записи
  buffer_min       integer     NOT NULL DEFAULT 0,
  status           text        NOT NULL,
  hold_expires_at  timestamptz,
  source           text        NOT NULL,
  -- Токен для GET /v1/public/appointments/:id и отмены клиентом (§7).
  -- Хранится открыто: ссылка с ним нужна в тексте напоминаний (Шаг 8).
  -- TODO: хранить хеш, если ссылки в напоминаниях станут перевыпускаться.
  public_token     text        NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  notes            text,
  cancelled_at     timestamptz,
  cancelled_by     text,
  cancel_reason    text,
  -- NULL — запись из виджета или от врача через Telegram
  created_by       uuid        REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT appointments_clinic_id_id_key   UNIQUE (clinic_id, id),
  CONSTRAINT appointments_public_token_key   UNIQUE (public_token),
  CONSTRAINT appointments_range              CHECK (end_at > start_at),
  CONSTRAINT appointments_buffer_min         CHECK (buffer_min >= 0),
  CONSTRAINT appointments_status             CHECK (status IN (
    'hold', 'pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired'
  )),
  CONSTRAINT appointments_source             CHECK (source IN ('widget', 'admin', 'telegram')),
  CONSTRAINT appointments_cancelled_by       CHECK (
    cancelled_by IS NULL OR cancelled_by IN ('client', 'clinic', 'dentist', 'system')
  ),
  CONSTRAINT appointments_hold_has_expiry    CHECK (status <> 'hold' OR hold_expires_at IS NOT NULL),
  CONSTRAINT appointments_patient_required   CHECK (status IN ('hold', 'expired') OR patient_id IS NOT NULL),
  CONSTRAINT appointments_cancel_consistent  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),

  CONSTRAINT appointments_location_fk FOREIGN KEY (clinic_id, location_id)
    REFERENCES locations (clinic_id, id),
  CONSTRAINT appointments_dentist_fk  FOREIGN KEY (clinic_id, dentist_id)
    REFERENCES dentists (clinic_id, id),
  CONSTRAINT appointments_service_fk  FOREIGN KEY (clinic_id, service_id)
    REFERENCES services (clinic_id, id),
  CONSTRAINT appointments_patient_fk  FOREIGN KEY (clinic_id, patient_id)
    REFERENCES patients (clinic_id, id),

  -- §2.1 дословно. Нарушение → SQLSTATE 23P01 → код slot_taken + альтернативы.
  -- Буфер в ограничение не входит (как и в §2.1): сами приёмы не пересекутся
  -- никогда, но при гонке две записи могут встать встык без буфера (Q11).
  CONSTRAINT appointments_no_dentist_overlap EXCLUDE USING gist (
    dentist_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status IN ('hold', 'pending', 'confirmed'))
);

CREATE INDEX appointments_clinic_start_idx  ON appointments (clinic_id, start_at);
CREATE INDEX appointments_dentist_start_idx ON appointments (dentist_id, start_at);
CREATE INDEX appointments_patient_idx       ON appointments (patient_id) WHERE patient_id IS NOT NULL;
-- Очистка истёкших холдов задачей worker (Шаг 5)
CREATE INDEX appointments_hold_expiry_idx   ON appointments (hold_expires_at) WHERE status = 'hold';


-- -----------------------------------------------------------------------------
-- notifications — журнал исходящих уведомлений (§8, Шаг 8).
-- Текст сообщения не хранится — в нём ПДн. Хранится вид шаблона (kind);
-- шаблон рендерится в момент отправки.
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            uuid        NOT NULL REFERENCES clinics (id),
  appointment_id       uuid,
  channel              text        NOT NULL,
  kind                 text        NOT NULL,
  -- Получатель — ровно один из двух
  patient_id           uuid,
  dentist_id           uuid,
  status               text        NOT NULL DEFAULT 'scheduled',
  scheduled_for        timestamptz NOT NULL DEFAULT now(),
  -- id задачи BullMQ: по нему напоминание снимается при отмене записи
  job_id               text,
  attempts             integer     NOT NULL DEFAULT 0,
  -- Только код/класс ошибки провайдера, без ПДн
  last_error           text,
  provider_message_id  text,
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_channel        CHECK (channel IN ('sms', 'telegram')),
  CONSTRAINT notifications_kind           CHECK (kind IN (
    'appointment_created', 'appointment_confirmed', 'appointment_cancelled',
    'appointment_rescheduled', 'reminder_24h', 'reminder_2h'
  )),
  CONSTRAINT notifications_status         CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled')),
  CONSTRAINT notifications_one_recipient  CHECK (num_nonnulls(patient_id, dentist_id) = 1),
  CONSTRAINT notifications_attempts       CHECK (attempts >= 0),

  CONSTRAINT notifications_appointment_fk FOREIGN KEY (clinic_id, appointment_id)
    REFERENCES appointments (clinic_id, id),
  CONSTRAINT notifications_patient_fk     FOREIGN KEY (clinic_id, patient_id)
    REFERENCES patients (clinic_id, id),
  CONSTRAINT notifications_dentist_fk     FOREIGN KEY (clinic_id, dentist_id)
    REFERENCES dentists (clinic_id, id)
);

-- Выборка к отправке
CREATE INDEX notifications_due_idx         ON notifications (scheduled_for) WHERE status = 'scheduled';
CREATE INDEX notifications_appointment_idx ON notifications (appointment_id) WHERE appointment_id IS NOT NULL;
-- Не больше одного активного напоминания каждого вида на запись и получателя
CREATE UNIQUE INDEX notifications_reminder_once_idx
  ON notifications (appointment_id, kind, channel, coalesce(patient_id, dentist_id))
  WHERE kind IN ('reminder_24h', 'reminder_2h') AND status <> 'cancelled';


-- -----------------------------------------------------------------------------
-- telegram_link_tokens — одноразовые токены привязки врача (§8).
-- Ссылка t.me/<bot>?start=<token>, TTL 24 ч. Payload /start — не длиннее
-- 64 символов [A-Za-z0-9_-]: токен — 32 случайных байта в base64url (43 символа).
-- Хранится только SHA-256 токена (hex): сам токен показывается один раз.
-- -----------------------------------------------------------------------------
CREATE TABLE telegram_link_tokens (
  token_hash  text        PRIMARY KEY,
  clinic_id   uuid        NOT NULL REFERENCES clinics (id),
  dentist_id  uuid        NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  uuid        REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT telegram_link_tokens_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT telegram_link_tokens_expiry      CHECK (expires_at > created_at),
  CONSTRAINT telegram_link_tokens_dentist_fk  FOREIGN KEY (clinic_id, dentist_id)
    REFERENCES dentists (clinic_id, id) ON DELETE CASCADE
);

CREATE INDEX telegram_link_tokens_dentist_idx ON telegram_link_tokens (dentist_id);


-- -----------------------------------------------------------------------------
-- telegram_updates — дедупликация вебхука по update_id (§8): Telegram
-- повторяет доставку. Бот один на платформу, поэтому clinic_id здесь нет —
-- единственное осознанное исключение из правила тенантности.
-- TODO: чистка строк старше N дней задачей worker.
-- -----------------------------------------------------------------------------
CREATE TABLE telegram_updates (
  update_id    bigint      PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- phone_verifications — SMS-коды подтверждения телефона (§7 POST /verifications).
-- Код хранится только как HMAC-SHA256 с серверным секретом: простой хеш
-- короткого цифрового кода перебирается мгновенно.
-- Лимит попыток и TTL — в коде (Q4).
-- -----------------------------------------------------------------------------
CREATE TABLE phone_verifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid        NOT NULL REFERENCES clinics (id),
  phone        text        NOT NULL,
  code_hash    text        NOT NULL,
  attempts     integer     NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  verified_at  timestamptz,
  -- Подтверждение израсходовано на запись: один код — одна запись
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT phone_verifications_phone_e164         CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT phone_verifications_attempts           CHECK (attempts >= 0),
  CONSTRAINT phone_verifications_consumed_verified  CHECK (consumed_at IS NULL OR verified_at IS NOT NULL)
);

CREATE INDEX phone_verifications_lookup_idx
  ON phone_verifications (clinic_id, phone, created_at DESC);
