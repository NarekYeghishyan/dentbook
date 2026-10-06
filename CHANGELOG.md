# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are grouped
by the [Conventional Commits](https://www.conventionalcommits.org/) type of the change that
produced them (CLAUDE.md §9).

Один раздел на шаг плана из CLAUDE.md §10. Раздел закрывается только когда выполнен
критерий «Готово» этого шага.

## [Unreleased]

### После сдачи

#### Changed

- `feat(miniapp): let the dentist change the service of a booking` — в «Услуга и время»
  на странице записи врач выбирает другую услугу из своего списка; сетка и проверка —
  по длительности новой услуги, `POST /v1/miniapp/appointments/:id/move` принимает
  `serviceId`. Проверки, история и SMS клиенту — как в журнале.

- `feat: mask the phone field in the admin panel and the Mini App` — поля телефона в журнале,
  карточке клиента, филиале и Mini App форматируются при вводе (`maskPhone` в
  `packages/shared`): без «+» — номер США `(202) 555-0123`, с «+» — по шаблону страны.
  Меняются только разделители, сервер читает номер как раньше.

- `feat(admin): let the front desk change the client phone on the client card` — телефон
  в карточке клиента больше не заблокирован: «Телефон (необязательно)», в любом виде, как
  при записи; пусто — клиент без номера. Новый номер сразу у всех записей клиента и у их
  SMS-напоминаний. Номер, который уже у другого клиента клиники, не принимается: панель
  пишет, чей он, и даёт ссылку на ту карточку — карточки не сливаются. Подтверждение номера
  кодом с сайта сбрасывается.
  - API: `phone` в `PATCH /v1/admin/clients/:id` (`updateClientSchema`); занятый номер —
    409 `validation_failed` с `client: { id, fullName }`.
  - ADR-0012, интеграционные тесты (в том числе изоляции: номер клиента A свободен для
    клиники B и ответ ничего не выдаёт о клинике A) и e2e.
- `feat: add the logo and favicon from dentalunivers.com` — знак с сайта заказчика
  (https://dentalunivers.com, `logo.svg` — тот же, что значок вкладки там, и
  `apple-touch-icon.png`) стал значком вкладки панели и Mini App и стоит рядом с
  «DentBook» в шапке панели и на страницах входа и регистрации. Файлы — в `public/`
  приложений, отдаются как есть (`no-cache`); тест раздачи. Заодно на странице входа список
  языков больше не растягивается на всю ширину. Форма записи на сайтах клиник не меняется.
- `feat: keep one note per booking in the client history and show it to the dentist` —
  правка заметки к записи больше не добавляет новую заметку в карточку клиента: у записи
  одна заметка, новый текст правит её (с пометкой «изменена» и автором нового текста),
  убранный — убирает её и из карточки, новый клиент записи забирает её к себе. Врач в Mini
  App видит в своей записи все заметки о клиенте, в том числе заметки регистратуры из
  карточки, — только для чтения (уточнение Q19).
  - БД: `patient_notes.updated_at` (0015); дубли заметок записей слиты в одну строку на
    запись (0016, проверено на копии с дублями, убранной заметкой и сменой клиента);
    уникальный индекс `patient_notes_appointment_key` (0017). `schema.sql` обновлён.
  - API: `GET /v1/miniapp/appointments/:id/client-notes`; `ClientNote.edited`, `at` — время
    нынешнего текста. Заметки к записям пишет `syncBookingNote` (журнал, Mini App, сайт).
  - Подпись автора («Регистратура · …», «Врач · …») — общая функция `actorLabel` в панели
    и в Mini App.
  - ADR-0012, Q19, интеграционные тесты (в том числе изоляции Mini App) и e2e.
- `feat(admin): make the booking notes field multi-line` — «Заметки (необязательно)» в
  «Новой записи» и «Изменить запись» журнала — многострочное поле, перенос строки
  сохраняется. Общий компонент `Textarea` в `components/ui.tsx`; им же стало поле новой
  заметки в карточке клиента. Проверка в e2e.
- `feat: keep every note about a client as a history on the client card` — в карточке
  клиента вместо одного поля «Заметки» — история: заметку можно добавлять сколько угодно
  раз, у каждой видны время и автор, новые сверху. Заметка к записи — та же заметка: то,
  что пишет регистратура в журнале, врач в Mini App и клиент на сайте, попадает в историю
  со ссылкой на запись (при создании записи и при каждом новом тексте). Правки нет; удалить
  заметку может владелец или администратор, регистратура только добавляет (Q19).
  - БД: таблица `patient_notes` (0012); прежнее поле карточки и текущие заметки записей
    перенесены в неё (0013, проверено на копии с данными); `patients.notes` удалено (0014).
    `schema.sql` обновлён.
  - API: `POST /v1/admin/clients/:id/notes`, `DELETE /v1/admin/clients/:id/notes/:noteId`
    (владелец и администратор); `ClientCard.notes` — список заметок; `notes` убрано из
    `PATCH /v1/admin/clients/:id`.
  - Врач историю в Mini App пока не видит (Q19).
  - ADR-0012, Q19, интеграционные тесты (в том числе изоляции тенантов) и e2e.
- `feat(admin): let the front desk edit a saved booking` — в карточке записи журнала есть
  кнопка «Изменить»: она открывает форму записи с данными записи — врач, услуга, дата,
  время, длительность, клиент, заметки. Время, врача, услугу и длительность можно менять до
  начала визита (новое место проверяется как при записи; занято — ближайшее свободное время
  одним нажатием), клиента и заметки — и после. У отменённой записи кнопки нет.
  - API: `PATCH /v1/admin/appointments/:id` принимает, кроме `startAt` и `dentistId`, ещё
    `serviceId`, `durationMin`, `client`, `notes`; все поля необязательны, сервер меняет
    только то, что отличается. Новая услуга приносит свой буфер, без своей длительности —
    и свою длительность. `rescheduleSchema` → `appointmentUpdateSchema`,
    `rescheduleAppointment` → `updateAppointment` (им же переносит врач в Mini App).
  - Клиент меняется по тем же правилам, что у врача в Mini App (Q9): логика вынесена в
    `setBookingClient`. Email клиента правится там же и в историю записи не попадает.
  - История: одно событие на правку; новые строки «Услуга» и «Длительность» (журнал и Mini
    App). Только время и врач — «Перенесена», иначе «Изменены данные».
  - Уведомления: новое время или врач — как при переносе; только услуга или длительность —
    врачу «Запись изменена», клиенту SMS нет; только клиент и заметки — без уведомлений.
  - В журнале у клиента записи теперь есть `email` — форма открывается с ним.
  - ADR-0012, интеграционные тесты (в том числе изоляции тенантов) и e2e.
- `feat(admin): let the front desk book a client without a phone` — в «Новой записи» журнала
  телефон больше не обязателен: поле подписано «Телефон (необязательно)», пусто — клиент без
  номера, как у врача в Mini App. Такой клиент получает алерт врачу с именем, но не SMS.
  У каждой записи без номера свой клиент, даже если его выбрали в поиске.
  - API: `staffBookingSchema` берёт `anyPhoneSchema`; `freePhoneSchema` удалена.
  - ADR-0010, ADR-0012, интеграционный и e2e-тесты.
- `feat: let the dentist and the front desk change the duration of one booking` — в «Новой
  записи» (Mini App и журнал) есть поле «Длительность»: сначала — как у выбранной услуги,
  её можно изменить для этой записи (5–480 мин): например, консультация не на 30, а на
  45 минут. Сетка времени Mini App считается по ней; услуга в каталоге не меняется, буфер
  после визита — от услуги. У «Другого» — то же поле.
  - API: `durationMin` в `POST /v1/miniapp/appointments` рядом с `serviceId` и в
    `POST /v1/admin/appointments`; `GET /v1/miniapp/slots` принимает `serviceId` вместе с
    `durationMin`. Движок доступности берёт длительность записи вместо длительности
    услуги; кеш слотов для своей длительности не используется.
  - Перенос (журнал и Mini App) теперь проверяет время по длительности самой записи, а не
    услуги — иначе удлинённую запись можно было перенести туда, где она не влезает.
  - ADR-0010, ADR-0012, интеграционные и e2e-тесты.
- `feat(admin): take the client phone in any form at the front desk` — в «Новой записи»
  журнала телефон по-прежнему обязателен, но формат больше не проверяется: сообщение
  «Введите корректный номер» убрано. Номер, который читается как американский или
  международный с «+», API приводит к E.164 — на него уходят SMS; остальное хранится как
  введено и SMS не получает. API: `staffBookingSchema` берёт `freePhoneSchema`. ADR-0010,
  ADR-0012, тесты.
- `feat: refresh the journal and the Mini App schedule by themselves` — записи меняют и
  врачи в Telegram, и регистратура, и сайт, а открытая страница об этом не знала до
  перезагрузки. Теперь журнал в панели и расписание в Mini App перечитываются раз в 15 с,
  пока они видны, и сразу при возврате на них (не ждут 30 с «свежести» данных). ADR-0012.
- `feat(miniapp): make the client name the headline of a schedule card` — в расписании Mini
  App имя клиента стало главным в карточке: крупно, жирно, цветом ссылки, сразу под
  временем. Нажатие на имя открывает запись, как «Изменить» (у отменённой — историю, имя
  серое). Услуга и телефон — одной строкой под именем. e2e-тест Mini App дополнен.
- `fix(miniapp): keep the slot step free after an "Other" booking` — у услуг клиники после
  визита есть буфер, а «Другое» его не имело: следующего клиента можно было поставить
  сразу на конец визита. Теперь после «Другого» держится шаг сетки клиники (например,
  50 минут + 5), и сетка времени учитывает это так же, как буфер услуги.
  - Миграция `0011_other_service_gap` дала этот буфер прежним «Другим». Запись, чьё
    удлинённое время задело бы следующую запись врача, осталась как была (§2.1).
  - ADR-0015, интеграционный тест.
- `fix(miniapp): show the booking's own time as selected when moving it` — в записи,
  открытой для правки, сетка «Перенести» сразу выделяет синим текущее время записи (раньше
  оно выглядело как любое свободное). «Перенести» нажимается, только когда выбрано другое
  время; при возврате на день записи её время снова выделено. e2e-тест Mini App дополнен.
- `feat(miniapp): let the dentist book a client without a phone` — телефон в записи врача
  (новая запись и правка) теперь необязательный: поле подписано «Телефон клиента
  (необязательно)», пусто — клиент без номера.
  - БД: `patients.phone` может быть NULL, CHECK `patients_phone_not_blank` — NULL или
    непустой текст (миграция `0010_patients_phone_optional`, `schema.sql`).
  - Клиент без номера — у каждой записи свой: найти его по телефону нельзя. Имя врач правит
    на месте; если убрать номер у клиента с номером, запись получает нового клиента без
    номера, а карточка с номером не меняется.
  - SMS такому клиенту не уходят (`no_phone`). В алертах врачу — только имя: шаблоны берут
    `{contact}` вместо `{client}, {phone}`. Расписание Mini App, журнал, карточка и список
    клиентов, история и CSV показывают отсутствие номера пустым местом или «—».
  - Регистратура и форма на сайте по-прежнему требуют номер.
  - ADR-0010, тесты: схема, API, worker, e2e.
- `feat(miniapp): name the custom service "Other"` — по просьбе владельца пункт «Своя
  услуга» стал «Другое», а поле названия убрано: врач вводит только длительность. Запись
  везде показывается с услугой «Другое» на языке клиники (`service.other` в переводах API).
  Подсказка «Только для этой записи…» тоже убрана. API больше не принимает
  `customService.name` (присланное старым Mini App просто не берётся). ADR-0015, тесты.
- `feat(miniapp): book a custom one-time service` — в «Новой записи» Mini App в списке
  услуг есть пункт «Своя услуга»: врач вводит название и длительность (5–480 мин), сетка
  времени пересчитывается под неё, дальше всё как обычно. Услуга остаётся только у этой
  записи — в следующий раз в списке её нет. Запись на неё показывается с этим названием
  везде (расписание, журнал, карточка клиента, CSV, алерты), переносится и отменяется как
  любая.
  - БД: `services.one_time` и CHECK `services_one_time_hidden` — разовая услуга никогда не
    публичная (миграция `0009_services_one_time`, `schema.sql`).
  - API: `POST /v1/miniapp/appointments` принимает `customService: { name, durationMin }`
    вместо `serviceId`; `GET /v1/miniapp/slots` — `durationMin` вместо `serviceId`.
    Каталог в панели, назначение услуг врачу и публичный API разовые услуги не видят.
    Перенести такую запись в журнале можно к любому работающему врачу.
  - Врач без услуг из каталога теперь тоже может записывать — на свою услугу.
  - ADR-0015, интеграционные тесты (API и схема), e2e-тест Mini App.
- `feat(miniapp): open a booking from its red cell in the time grid` — в сетке «Время»
  (новая запись и перенос) красная клетка записи теперь нажимается и открывает эту запись:
  клиент, комментарий, перенос, отмена, история — как по «Изменить» в расписании. «Назад»
  возвращает на ту же вкладку, на день записи. Клетка холда (клиент как раз записывается на
  сайте) и серая клетка закрытого времени не нажимаются.
  - API: в `busy` у клетки записи — `appointmentId`; новый `GET /v1/miniapp/appointments/:id`
    отдаёт одну свою запись, чужая — 404 (тест изоляции дополнен).
  - ADR-0014, интеграционные тесты, шаг в e2e-тесте Mini App.
- `feat(miniapp): accept the client phone in any form` — врач в Mini App вводит телефон
  клиента в любом виде, и при записи, и при правке: проверки формата больше нет, поле
  только обязательное (до 50 знаков). Номер, который читается как американский или
  международный с «+», API по-прежнему приводит к E.164; остальное хранится как введено.
  - SMS клиенту (подтверждение, напоминания, перенос, отмена) на номер не в E.164 не
    уходят: worker не зовёт провайдера и помечает уведомление `cancelled` с причиной
    `phone_not_e164`.
  - БД: `patients_phone_e164` заменено на `patients_phone_not_blank` (миграция
    `0008_patients_phone_free_text`, `schema.sql`). Регистратура в журнале и форма на сайте
    по-прежнему требуют номер, который приводится к E.164.
  - ADR-0010, тесты: схема `anyPhoneSchema`, запись и правка с таким номером в API, пропуск
    SMS в worker.
- `feat: open the booking form in a popup from buttons on the clinic website` — у ключа на
  странице «Сайт» новый выбор «Как показывать форму»: «На странице» (как раньше) или «Во
  всплывающем окне по кнопке». Выбирается при создании ключа и меняется потом.
  - Виджет: `data-mode="popup"` — форма во всплывающем окне, его открывает клик по любой
    кнопке или ссылке сайта с классом `dentbook-open` (свой селектор — `data-trigger`),
    в том числе добавленной на страницу позже. Окно — нативный `<dialog>` в Shadow DOM:
    затемнение, крестик, Esc, клик мимо, фокус внутри окна, страница под ним не
    прокручивается; на телефоне — во весь экран. В API окно не ходит, пока его не
    открыли; закрытое и открытое снова, продолжает с того же шага. Бандл — 13 КБ gzip.
  - Режим хранится у ключа: `api_keys.embed_mode` (`inline` | `popup`, по умолчанию
    `inline`; миграция `0007_api_keys_embed_mode`, `schema.sql`). По нему панель показывает
    нужный код и класс для кнопок с кнопкой «Копировать». Сама форма режим берёт из кода
    на сайте, поэтому смена режима в панели уже вставленный код не меняет.
  - `docs/embed.md`, ADR-0009, тестовая страница `apps/widget/test-page/popup.html`,
    e2e-тесты окна.
- `feat(miniapp): show cancelled bookings on request` — в расписании Mini App флажок
  «Показывать отменённые записи». Отменённая запись — серым, время зачёркнуто, подпись
  «Отменил клиент» / «Отменила клиника» / «Отменили вы»; вместо «Изменить» — «История»:
  запись открывается только для просмотра, история сразу раскрыта. Флажок помнится на
  устройстве (`localStorage`), по умолчанию снят — расписание как раньше.
  - API: `GET /v1/miniapp/schedule` принимает `cancelled=true|false` (по умолчанию
    `false`), в `MiniappAppointment` добавлено `cancelledBy`. Чужие отменённые записи не
    видны и с флажком — тест изоляции дополнен.
  - Справка админки о Telegram дополнена.
- `feat: keep the history of every booking and show busy time in the mini app grid` —
  ADR-0014.
  - **История записи.** Новая таблица `appointment_events` (миграции
    `0005_appointment_events`, `0006_appointment_events_backfill`, `schema.sql`). Событие
    пишется в той же транзакции, что и изменение: создание, подтверждение, правка клиента
    и комментария, перенос (время и врач), отмена, «пришёл» / «не пришёл» — с автором
    (клиент, врач, сотрудник) и прежним и новым значением. Неудачные попытки и изменения
    «в то же самое» следа не оставляют. Для существующих записей перенесены создание и
    отмена — прошлых переносов и правок в данных не было.
  - Кнопка «История» — в окне записи Mini App (`GET /v1/miniapp/appointments/:id/history`,
    только своя запись) и в окне записи журнала админки
    (`GET /v1/admin/appointments/:id/history`). Новые события сверху.
  - **Сетка «Время» в Mini App** показывает и занятое: запись — одной красной клеткой на
    время начала, закрытое время — серой, с подписью внизу. `/slots` отдаёт поле `busy`.
- `feat(miniapp): let the dentist edit, move and cancel bookings` — у каждой записи в
  расписании Mini App — кнопка «Изменить». Врач правит клиента (имя, телефон) и
  комментарий любой своей записи — с сайта, из регистратуры или своей; предстоящую
  запись ещё переносит на другое свободное время или отменяет. Решение владельца
  2026-10-02: все четыре действия, на всех записях врача.
  - API: `PATCH /v1/miniapp/appointments/:id` (`client`, `notes`; `null` или пустая строка
    убирает комментарий), `POST …/:id/move`, `POST …/:id/cancel`; `/slots` принимает
    `appointmentId` — время самой записи для её переноса свободно. В `MiniappAppointment`
    добавлены `serviceId` и `locationId`.
  - Клиент в клинике — по телефону (Q9): новое имя меняет карточку клиента, новый
    телефон переводит запись на клиента с этим номером, и запланированные напоминания
    уходят на новый номер.
  - Перенос и отмена — те же `rescheduleAppointment` / `cancelByClinic`, что у журнала,
    с параметром `byDentistId`: только записи этого врача (чужая — 404), пересечения
    держит EXCLUDE (§2.1). Клиенту SMS о переносе или отмене, напоминания переставляются
    или снимаются; алерта в Telegram самому врачу нет. Отмена пишет
    `cancelled_by = 'dentist'`.
  - Сетка свободного времени вынесена в общий `SlotPicker` — для записи и для переноса.
  - Справка админки о Telegram дополнена.
- `feat(miniapp): add a comment field to the dentist booking form` — в «Новой записи»
  Mini App после имени и телефона клиента — необязательный «Комментарий» (до 1000
  символов, многострочный). Сохраняется в `appointments.notes`: API и схема
  `miniappBookingSchema` его уже принимали, не хватало поля в форме. Комментарий виден в
  расписании врача (переводы строк сохраняются) и в карточке записи журнала админки.
- `feat(telegram): let the dentist choose the bot and mini app language` — врач сам
  переключает язык в Telegram: команда `/language` в боте (кнопки подписаны самим языком —
  English, Русский, Հայերեն) и список в шапке Mini App. Выбор один на обе поверхности,
  хранится в `dentists.locale` (миграция `0004_dentists_locale`, NULL — не выбирал). На
  этом языке приходят и алерты о записях: `describeAppointment` отдаёт язык врача записи,
  язык клиники остаётся в `clinicLocale` — на нём пишут прежнему врачу при переносе. Язык
  клиники и SMS клиентам не затронуты.
- `feat(admin): show the UTC offset in time zone lists` — в списках часовых поясов
  (регистрация, настройки клиники, офисы) к названию добавлено текущее смещение:
  `Asia/Yerevan (GMT+4)`; летнее время учитывается.
- `feat(widget): add a country selector to the phone field` — «Мобильный телефон» в форме
  записи разделён на список стран (`+1 United States`, названия — из `Intl.DisplayNames`
  на языке формы) и номер; страна по умолчанию — из языка клиники. Номер собирается в
  E.164 функцией `toE164In` из `@dentbook/shared/phone`: ведущий ноль национального
  набора отбрасывается, ввод с «+» или «00» сильнее выбранной страны.
- `feat(widget): search the country list` — стран больше двухсот, поэтому выбор страны
  открывает панель с поиском: по названию (без учёта регистра и диакритики), коду страны
  (`US`) и телефонному коду (`374`, `+374`). Разметка combobox + listbox: стрелки, Enter,
  Escape, щелчок мимо закрывает.
- `feat(widget): mask the phone number by country` — номер форматируется на вводе по
  шаблону выбранной страны (`(202) 555-0123`, `91 234567`), он же стоит подсказкой в
  поле; курсор остаётся у той же цифры при правке в середине. Шаблоны — `NUMBER_FORMATS`
  в `@dentbook/shared/countries` (около ста направлений), для остальных стран номер
  остаётся таким, как его ввели. Цифры маска не теряет: лишние дописываются в конец,
  ведущая единица NANP и ведущий ноль национального набора остаются перед номером.
- `feat(admin): add the roles and permissions page` — раздел «Роли и права» в панели после
  «Настроек», виден всем сотрудникам: матрица прав по разделам (журнал, клиенты и дашборд —
  всем; данные клиники, ключи и сотрудники — владельцу и администратору; регистратуре
  просмотр), для чего нужна каждая роль, и короткая справка о работе платформы — настройка
  по порядку, запись с сайта и выбор врача, расчёт свободного времени, журнал, Telegram у
  врачей, напоминания. Матрица собрана по `config` роутов `/v1/admin`, тексты — в словарях
  en/ru/hy.
- `docs(admin): explain how to connect a dentist to Telegram` — в «Роли и права» раздел
  «Врачи в Telegram» стал инструкцией: что врач делает в боте, подключение по шагам
  (ссылка или QR-код в карточке врача, «Старт», кнопка «Schedule») и оговорки —
  подтверждение из уведомления, закрытие времени с визитами, час работы расписания, один
  аккаунт на врача, бот ещё не включён оператором.
- `docs(deploy): record the telegram bot on the stand` — на стенде включён бот
  `@Dentbook01_bot`: `TELEGRAM_*` и `PUBLIC_BASE_URL` в `.env` сервера, вебхук и кнопка
  меню Mini App выставлены `telegram-setup.ts`; `deploy/README.md` и `docs/PROGRESS.md`
  обновлены.
- `feat(api): redirect the bare domain to the admin panel` — адрес платформы без пути
  (`https://dentbook.dentalunivers.com/`) отвечал JSON `not_found`, и вход в панель не
  находили. Теперь `/` ведёт на `/admin/` (302), если собранная панель раздаётся
  (`redirectRoot` в `spaStatic`).

### Шаг 10 — сдача (закрыт 2026-09-18)

#### Added

- `feat(api): add the platform operator api` — `/v1/admin/operator`: клиники со сводкой,
  приостановка и возобновление, состояние платформы (провайдеры, очереди BullMQ, ошибки
  доставки за сутки); команда `create-operator.ts`; бот отказывает приостановленной клинике.
- `feat(admin): add the platform operator panel` — «Оператор платформы» в панели, вход ведёт
  туда по роли.
- `test: add the booking load test` — `apps/api/src/load-test.ts` и
  `load.integration.test.ts`: 50 клиентов на один слот → одна запись.
- `feat(deploy): back up the database and rotate container logs` — `deploy/backup.sh`,
  `x-logging` в `deploy/docker-compose.yml`.
- `docs: add the public API reference and embed guide` — `docs/api/public-api.md`,
  `docs/embed.md`.
- `docs: close step 10 and add ADR-0013`, Q18; чек-лист боевого запуска.

#### Changed

- `POST /v1/admin/auth/login` отвечает `200 { role }` вместо `204`.

#### Verified

- 444 теста, `pnpm lint`, `pnpm typecheck` зелёные; `pnpm test:e2e` — 12 сценариев;
  нагрузочный прогон на стенде.

### Шаг 9 — журнал и отчёты (закрыт 2026-09-18)

#### Added

- `feat(core): measure working minutes of a dentist` — `workingMinutes`: шаблон + extra −
  block за диапазон дат, ночная смена — один раз.
- `feat(api): add the front desk journal api` — журнал офиса, запись сотрудником, перенос
  (EXCLUDE отклоняет пересечения), подтверждение, отмена клиникой, «пришёл» / «не пришёл»;
  поиск и карточка клиента; дашборд; выгрузка CSV; уведомления врачам и клиенту о переносе
  и отмене.
- `feat(admin): add the journal, clients and dashboard` — «Журнал» с перетаскиванием,
  записью клиента и действиями с записью; «Клиенты» и карточка; «Дашборд»; en/ru/hy.
- `test: add journal end-to-end test` — перенос мышью в Chromium.
- `docs: add ADR-0012`, Q17.

#### Changed

- Навигация панели: «Журнал» — стартовая страница, «Календарь» переименован в «Свободное
  время». Вход ведёт в журнал.
- `pnpm test:e2e` собирает и панель.

#### Verified

- 434 теста, `pnpm lint`, `pnpm typecheck` зелёные; `pnpm test:e2e` — 12 сценариев; 8
  одновременных переносов на одно время → ровно один.

### Шаг 8 — уведомления (закрыт 2026-09-18)

#### Added

- `feat(shared): share the twilio sender` — `@dentbook/shared/sms`: `TwilioSmsSender`
  возвращает SID сообщения, отказ — `SmsError` с кодом и признаком «повтор не поможет».
- `feat(api): schedule client reminders and confirmation sms` — очередь `sms`: напоминания
  за 24 ч и 2 ч при записи с сайта и врачом в Mini App, SMS о подтверждении записи в боте
  и в Mini App (Q12), снятие напоминаний при отмене клиентом.
- `feat(worker): send client sms from the queue` — текст из БД в момент отправки, шаблоны
  en/ru/hy, пропуск неуместных уведомлений (запись не подтверждена, визит начался),
  повторы с паузой, постоянный отказ — сразу `failed`.
- `feat(worker): keep quiet hours and add the opt-out line` — Q16: напоминания на
  21:00–8:00 по времени офиса не шлются, в каждом SMS — «Reply STOP to opt out».
- `docs: add ADR-0011`, Q16 и Q17 с ответами.

#### Changed

- Разбор окружения worker'а: `SMS_PROVIDER`, `TWILIO_*`, `SMS_SENDER`, как у API.
- `Notifier`: `appointmentConfirmed`; `appointmentCreated` без алерта врачу для его
  собственной записи.

#### Verified

- 390 тестов, `pnpm lint`, `pnpm typecheck` зелёные; `pnpm test:e2e` — 10 сценариев.

### Шаг 7 — бот и Mini App (закрыт 2026-09-18)

#### Added

- `feat(shared): add telegram queue and mini app contracts` — очередь `telegram`, задачи
  сообщений и ответов на кнопки, контракт `/v1/miniapp`.
- `feat(api): add telegram bot webhook, linking and alerts` — `/telegram/webhook` с
  секретным заголовком и дедупликацией по `update_id`; привязка по `/start <токен>`
  (одноразовый, 24 ч, в БД — SHA-256); алерты о новой записи и отмене, кнопка
  «Подтвердить», напоминание о неподтверждённой записи через 2 ч (Q12); ссылка привязки и
  отключение в `/v1/admin/dentists/:id/telegram*`.
- `feat(api): add dentist mini app api` — `/v1/miniapp`: вход по initData (подпись и
  свежесть, §8), расписание, закрытие и открытие времени, свободное время, запись своего
  клиента, подтверждение.
- `feat(worker): send telegram messages from the queue` — отправка с backoff, 403 →
  `telegram_blocked` без повторов, отметки в `notifications`.
- `feat(miniapp): add dentist schedule mini app` — `apps/miniapp` на `/miniapp/`:
  расписание дня, закрыть время (со списком записей, если время занято), новая запись;
  en/ru/hy, тема Telegram.
- `feat(admin): connect dentists to telegram` — блок Telegram в карточке врача: статус,
  ссылка с копированием и QR-кодом (Q15), отключение.
- `feat(api): add telegram bot setup script` — `apps/api/src/telegram-setup.ts`: вебхук,
  кнопка меню Mini App, описание `/start` на трёх языках.
- `test: add mini app end-to-end test` — Mini App в Chromium против настоящего API.
- `docs: add ADR-0010`.

#### Changed

- `refactor(shared): move phone normalization to shared` — `toE164` в
  `@dentbook/shared/phone`: им пользуются форма записи и Mini App.
- `Dockerfile` собирает Mini App и задаёт `MINIAPP_DIST_DIR`; `pnpm test:e2e` собирает его
  перед тестами.
- `.env.example`: раздел Telegram описан, `TELEGRAM_WEBHOOK_URL` и `MINIAPP_URL` убраны —
  адреса выводятся из `PUBLIC_BASE_URL`; добавлен `MINIAPP_DIST_DIR`.

#### Verified

- 363 теста, `pnpm lint`, `pnpm typecheck` зелёные; `pnpm test:e2e` — 10 сценариев, из них
  3 для Mini App: без подписи Telegram, чужой аккаунт, полный цикл врача.

### Шаг 6 — виджет (закрыт 2026-09-18)

#### Added

- `feat(widget): add booking form` — `apps/widget`: форма записи без фреймворка в Shadow DOM,
  en/ru/hy, телефон → E.164, холд с обратным отсчётом, альтернативы, отмена; 8.2 КБ gzip.
- `feat(api): add turnstile captcha and twilio sms` — капча перед SMS-кодом, Twilio REST,
  провайдеры по переменным окружения; `GET /v1/public/config` отдаёт site key.
- `feat(api): serve the widget bundle` — `/widget/dentbook-widget.js`, короткий кеш,
  `Cross-Origin-Resource-Policy: cross-origin`; сборка и проверка размера в `Dockerfile`.
- `feat(admin): show the embed code` — готовый код встраивания на странице «Сайт».
- `test: add browser end-to-end booking test` — Playwright + Chromium в Vitest
  (`pnpm test:e2e`), тестовая страница клиники на отдельном origin.
- `docs: add ADR-0009`.

#### Changed

- `.env.example`: `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SMS_SENDER`,
  `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET`, `WIDGET_DIST_DIR` вместо заготовок Шага 1.
- Разбор окружения требует ключи Twilio при `SMS_PROVIDER=twilio` и пару ключей капчи.

#### Verified

- 310 тестов, `pnpm lint`, `pnpm typecheck` зелёные; `pnpm test:e2e` — 7 сценариев в
  Chromium: запись end-to-end, «Назад» отпускает холд, истёкший холд возвращает к выбору
  времени, изоляция стилей, телефон 375 px, чужой ключ, размер бандла;
- стенд: форма на `https://mashna.am` (демо-клиника) — услуга → 12 дней свободного времени →
  холд → данные; отправка кода честно отвечает «онлайн-запись недоступна» до ключей Twilio.

#### Fixed

- `fix(widget): leave hold-bound steps before releasing the hold` — «Назад» с шага данных,
  истечение холда по таймеру и ответ `hold_expired` роняли экран (обращение к холду, которого
  уже нет), а после `hold_expired` слоты не перечитывались. Найдено проверкой на
  `mashna.am`, покрыто e2e-сценариями.

### Шаг 5 — ключи и публичный API (закрыт 2026-09-18)

#### Added

- `feat(db): protect the buffer after a visit` — Q11: `appointments.blocked_until`, CHECK и
  EXCLUDE по `tstzrange(start_at, blocked_until)` (миграция `0003`), помощники
  `blockedUntil()`, `lockDentist()`, `expireStaleHolds()`; §2.1 в CLAUDE.md обновлён.
- `feat(api): cache availability in redis` — кеш слотов (§6, TTL 60 с), сброс по врачу и по
  клинике; ключи — `@dentbook/shared/cache-keys`.
- `feat(api): lock schedule changes against bookings` — блок и удаление extra под
  advisory-lock врача (TODO Шага 4).
- `feat(api): issue and revoke publishable keys` — `/v1/admin/api-keys`, `pk_` + 192 бита.
- `feat(api): add public booking api` — `/v1/public`: ключ и Origin (§2.5), CORS, лимиты в
  Redis, config/services/availability, холды с назначением врача и альтернативами,
  SMS-коды, подтверждение, статус и отмена по токену; тексты SMS в переводах.
- `feat(worker): expire stale holds` — задача BullMQ раз в минуту, сброс кеша врачей.
- `feat(admin): manage website keys` — страница «Сайт»: ключи, сайты, отзыв.
- `test: cover public api, holds, concurrency and isolation` — Redis в Testcontainers,
  тестовый отправитель SMS только в тестах.
- `docs: add ADR-0008`.

#### Changed

- `.env.example`: `HOLD_TTL_SEC`, `PUBLIC_KEY_RATE_LIMIT`, `PUBLIC_IP_RATE_LIMIT`.
- Логи: токен записи из query не пишется, тело с данными клиента маскируется.

#### Verified

- 288 тестов, `pnpm lint`, `pnpm typecheck` зелёные; паритет `schema.sql` с миграциями;
- критерии: истёкший холд → слот снова доступен; 20 одновременных холдов → 2, остальные
  `slot_taken`; два одновременных подтверждения одного холда → одна запись.

### Шаг 4 — админский API и панель (закрыт 2026-09-18)

#### Added

- `feat(core): detect overlapping weekly shifts` — `findWeeklyOverlap`: смены через полночь
  и с воскресенья на понедельник.
- `feat(shared): add catalog and availability schemas` — филиалы, услуги (цена строкой),
  врачи, порядок, недельный шаблон, исключения, запрос календаря.
- `feat(api): add offices, services, dentists and schedule endpoints` — CRUD без удаления,
  `PUT /dentists/order`, `PUT /dentists/:id/services|working-hours`, исключения с проверкой
  записей (§8, `409 slot_taken` + `conflicts`).
- `feat(api): add availability calendar` — `services/availability.ts` поверх движка core,
  `GET /v1/admin/availability`.
- `feat(admin): add clinic panel` — React + TanStack Query + Tailwind: вход, регистрация,
  календарь, врачи с перетаскиванием, карточка врача, услуги, офисы, сотрудники, настройки;
  переводы en/ru/hy (JSON + `t()`), время в поясе филиала.
- `feat(api): serve the admin panel` — `/admin/` через `@fastify/static`: SPA-fallback, кеш
  хешированных файлов, CSP; сборка панели в `Dockerfile`.
- `test(api): cover catalog, availability and tenant isolation of new routes`,
  `test(admin): check translation dictionaries`.
- `docs: add ADR-0007` — раздача панели, время, переводы, константы без zod.

#### Changed

- `refactor(shared): move enums to a zod-free entry` — `@dentbook/shared/domain`: `LOCALES`,
  `STAFF_ROLES` и перечисления; фронтенды не тянут `zod`.
- `fix(api): treat empty env values as unset` — `.env`, скопированный из `.env.example`,
  получает значения по умолчанию, а не падает на `JWT_ACCESS_TTL=` (тест `env.test.ts`).
- `.env.example`: `ADMIN_DIST_DIR` вместо ненужного `ADMIN_ORIGIN` (панель на том же домене).

#### Verified

- 242 теста, `pnpm lint`, `pnpm typecheck`, `vite build` зелёные;
- сквозной сценарий в браузере (Playwright, локально): регистрация → офис → услуга → два
  врача со сменами → перетаскивание приоритета → календарь 155 слотов, врачи в новом
  порядке; переключение en/ru/hy; ширина 390 px;
- стенд `https://dentbook.mashna.am/admin/` (`3ca7865`): тот же сценарий проходит; страница
  отдаётся с CSP и `X-Frame-Options: DENY`.

### Шаг 3 — аутентификация и тенантность (закрыт 2026-09-18)

#### Added

- `feat(shared): add admin api schemas` — `validators.ts` (пояс, валюта, email, пароль, языки
  en/ru/hy), `admin.ts` (регистрация, вход, настройки клиники, сотрудники, формы ответов).
- `feat(api): add app factory and error handling` — `buildApp()` для сервера и тестов, единый
  формат ошибок §7, `parse()` через zod, ошибки БД в логах без ПДн (§2.6), `trustProxy` на одно
  звено.
- `feat(api): add admin sessions` — JWT в httpOnly-cookie (`SameSite=Strict`), пароли на
  `scrypt`, роль и активность из БД на каждом запросе, `config.roles` на роутах.
- `feat(api): add clinic registration and login` — `/v1/admin/auth/register|login|logout`,
  лимит попыток по IP, `GET /v1/admin/me`.
- `feat(api): add clinic settings and staff management` — `GET|PATCH /v1/admin/clinic`,
  `GET|POST /v1/admin/users`, `GET|PATCH /v1/admin/users/:id`.
- `test(db): add test database helper` — `@dentbook/db/testing`: Postgres в Testcontainers
  с миграциями.
- `test(api): cover auth, staff and tenant isolation` — изоляция тенантов на каждом роуте
  `/v1/admin`, сессии (истёкшая, чужая подпись, отключённый сотрудник, смена роли),
  приостановленная клиника, оператор платформы, лимит попыток.
- `docs: add ADR-0006` — сессии, роли, изоляция тенантов.

#### Changed

- `.env.example`: `JWT_SECRET`, `JWT_ACCESS_TTL`, `AUTH_RATE_LIMIT`; `JWT_REFRESH_TTL` убран —
  refresh-токенов нет (ADR-0006). `deploy/README.md`: `JWT_SECRET` на сервере.

#### Fixed

- до коммита: срок сессии задавался числом, и `@fastify/jwt` понимал его как секунды вместо
  миллисекунд — сессия жила бы в 1000 раз дольше. Срок передаётся строкой (`43200s`),
  тест на истёкшую сессию это проверяет.

#### Verified

- 166 тестов, `pnpm lint`, `pnpm typecheck` зелёные;
- тест изоляции падает, если убрать фильтр по `clinic_id` из запроса сотрудника.

### Шаг 2 — движок доступности (закрыт 2026-09-18)

#### Added

- `feat(core): add interval arithmetic and time zone helpers` — `intervals.ts` (полуоткрытые
  интервалы: нормализация, вычитание), `tz.ts` (настенное время ↔ UTC через `Intl`, границы
  местных суток, поведение в дни перевода часов как Temporal `compatible`).
- `feat(core): expand weekly working hours to utc` — `working-hours.ts`: шаблон `working_hours`
  → UTC-интервалы на дату, ночные смены (`end <= start`), `24:00`.
- `feat(core): pick dentist by priority and load` — `pickDentist` (§6).
- `feat(core): compute available slots` — `computeSlots` в порядке §6, `computeDaySlots`
  (слоты на местную дату), `mergeSlots` («любой врач»).
- `test(core): enforce coverage threshold` — порог 90% для `packages/core` в `vitest.config.ts`.
- `docs: add ADR-0005` — сетка, сутки, часовые пояса.

#### Verified

- 95 unit-тестов: буферы (услуги и записи), `block`/`extra`, границы рабочих часов,
  `notBefore`, полночь, DST в Нью-Йорке и Берлине, пояса без DST и с получасовым смещением;
- покрытие логики `packages/core` 100% (`index.ts` и `types.ts` — без исполняемого кода);
- тесты ловят поломки: без буфера записи, без ночной смены прошлого дня, при выборе второго
  из двух времён осенью.

### Тестовый стенд (вне порядка шагов, 2026-09-17)

#### Added

- `build: add app docker image` — `Dockerfile` и `.dockerignore`: один образ для api, worker,
  миграций и сидов; запуск через `node --import tsx` (ADR-0004).
- `build(deploy): add server compose stack` — `deploy/docker-compose.yml`: Postgres 16,
  Redis 7 (`noeviction` для BullMQ), `migrate` перед `api`/`worker`, API только на
  `127.0.0.1`, лимиты памяти.
- `build(deploy): add deploy script` — `deploy/deploy.sh`: загрузка рабочей копии без
  игнорируемых файлов, сборка образа с тегом коммита, миграции, перезапуск, очистка старых
  образов.
- `build(deploy): add nginx template` — `deploy/nginx/dentbook.conf.template`: TLS,
  ACME webroot, редирект с HTTP, прокси с `X-Request-Id` (§9).
- `docs: add deployment guide and ADR-0004` — `deploy/README.md`: подготовка сервера,
  nginx и certbot, выкладка, эксплуатация.
- `.env.example`: `POSTGRES_PASSWORD`, `API_HOST_PORT` для серверного стека.
- `docs: record test stand domains` — Q13 (закрыт: `mashna.am` — тестовый сайт клиники для
  виджета, платформа на `dentbook.mashna.am`) и Q14 (открыт: один домен или поддомены для
  частей платформы).
- `docs: record telegram link delivery` — Q15 (закрыт: ссылка привязки врача — кнопка
  «Скопировать» и QR-код в карточке врача, Шаг 7).
- `docs: resolve resources question` — Q10 (закрыт: `resources` — справочник филиала,
  в назначении врача и расчёте доступности не участвует).
- `docs: record answers to open questions` — закрыты Q4 (значения по умолчанию), Q6 (en/ru/hy,
  JSON + `t()`), Q7 (сервер — Node 22), Q11 (буфер защищается в БД, Шаг 5), Q12 (`pending` +
  повторный алерт, SMS при подтверждении), Q14 (один домен, пути). Q5: клиенты в США, капча
  Turnstile; SMS-провайдер — к Шагу 6.

#### Verified

- локально: образ собирается; стек поднимается с `--wait`; 3 миграции, 16 таблиц,
  расширения и `appointments_no_dentist_overlap` на месте; сид дважды без дублей;
  повторный `up` ничего не меняет; `/health` → 200; стек ~115 МБ RAM;
- стенд `https://dentbook.mashna.am`: `deploy.sh` проходит; `/health` → 200 через nginx,
  сертификат Let's Encrypt валиден, HTTP → HTTPS; наружу открыт только `127.0.0.1:3100`;
  соседние сайты сервера отвечают как до изменений.

### Шаг 1 — каркас и БД (закрыт 2026-09-17)

#### Added

- `chore: scaffold monorepo` — pnpm workspaces, структура `apps/*` и `packages/*` по
  CLAUDE.md §4, `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), project references, ESLint,
  Prettier, Vitest, `.env.example`, `.editorconfig`.
- `chore: add docker compose` — Postgres 16 и Redis 7 с healthcheck, `TZ=UTC`/`PGTZ=UTC`
  на контейнере БД (CLAUDE.md §2.3).
- `chore: add project working docs` — `README.md`, `CHANGELOG.md`, `docs/PROGRESS.md`,
  `docs/OPEN-QUESTIONS.md`, журнал решений `docs/adr/` (ADR-0001, ADR-0002).
- `feat(shared): add stable api error codes` — `packages/shared/src/errors.ts`: коды из
  CLAUDE.md §7 и тип тела ошибки `ApiErrorBody`.
- `feat(core): add availability engine types` — `packages/core/src/types.ts`: `Interval`,
  `ScheduleException`, `BusyAppointment`, `ComputeSlotsInput` по CLAUDE.md §6.
  Пакет без зависимостей и без I/O.
- `feat(api): add fastify bootstrap` — разбор окружения через zod с падением при
  отсутствии обязательных переменных (§9), сквозной `request_id`, редакция
  `authorization`/`cookie`/`phone`/`email` в логах (§2.6), `GET /health`,
  корректное завершение по SIGINT/SIGTERM.
- `feat(worker): add worker bootstrap` — подключение к Redis с
  `maxRetriesPerRequest: null` для BullMQ, корректное завершение. Обработчики задач
  добавляются на шагах 5, 7 и 8.
- `feat(db): add drizzle-kit config` — `packages/db/drizzle.config.ts`, миграции в
  `packages/db/src/migrations`, чтение `.env` из корня монорепо.
- `test(shared): lock error codes contract` — тест на состав и отсутствие дублей в
  `ERROR_CODES`.
- `feat(db): add reference schema` — `schema.sql`: 16 таблиц из CLAUDE.md §5, ограничение
  `appointments_no_dentist_overlap` из §2.1, составные FK `(clinic_id, x_id)` для изоляции
  тенантов на уровне БД (§2.2), холды как строки `appointments`. Решения — ADR-0003,
  вопросы к согласованию — Q9-Q11.
- `feat(db): add drizzle schema and migrations` — схема Drizzle 1:1 со `schema.sql`
  (`packages/db/src/schema`), миграции `0000_extensions`, `0001_init`,
  `0002_appointments_no_overlap` (EXCLUDE из §2.1 и gist-индекс — кастомной миграцией
  drizzle-kit), клиент `createDatabase()` с сессией в UTC, `pgErrorCode()` /
  `isExclusionViolation()` с разворачиванием `DrizzleQueryError.cause`.
- `feat(db): add demo seed` — идемпотентный сид демо-клиники (Europe/Berlin — пояс с
  переходом на летнее время; есть смена через полночь).
- `feat(shared): add domain enums` — `packages/shared/src/domain.ts`: статусы, роли, виды
  уведомлений; из них же строятся CHECK-ограничения схемы.
- `test(db): add schema integration tests` — Testcontainers + `postgres:16-alpine`: 50
  конкурентных записей на один слот → ровно одна; частичное пересечение и касание границ;
  холд освобождает слот после `expired`; запись со ссылкой на чужую клинику → `23503`;
  идемпотентность сида; полный паритет каталога БД после миграций со `schema.sql`.

#### Changed

- `feat(db): add booking confirmation setting` — `clinics.booking_requires_confirmation`
  (решение заказчика, Q9): подтверждать ли записи из виджета.
- `chore: make compose host ports configurable` — `POSTGRES_PORT` / `REDIS_PORT` в `.env`
  (по умолчанию 5432 / 6379), чтобы DentBook не конфликтовал с другими проектами.
- `chore(db): remove push script` — схема меняется только миграциями (§9).
- `feat(shared): add auth and not-found error codes` — `unauthorized`, `forbidden`,
  `not_found`, `internal_error` в `ERROR_CODES` и в CLAUDE.md §7 (решение заказчика, Q2).

#### Verified

- `pnpm install` — 9 workspace-проектов, постинсталл-скрипты разрешены поимённо
  (`allowBuilds`);
- `pnpm typecheck`, `pnpm lint`, `pnpm test` — проходят;
- `docker compose config` — валиден;
- падение API при отсутствии `DATABASE_URL`/`REDIS_URL` — проверено запуском;
- `schema.sql` — 61 проверка на встроенном Postgres (PGlite, PostgreSQL 18.3): EXCLUDE,
  составные FK между клиниками, CHECK/UNIQUE, значения по умолчанию.
- на чистой БД из docker compose: `pnpm migrate` (3 миграции), `pnpm seed` дважды,
  повторный `pnpm migrate` — без изменений, `drizzle-kit generate` — «No schema changes»;
- `pnpm test` — 14 тестов, из них 7 интеграционных на PostgreSQL 16;
- чувствительность тестов: без EXCLUDE-ограничения падают 2 теста конкурентности,
  при расхождении со `schema.sql` падает тест паритета.
