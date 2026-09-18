# Развёртывание

Решения и компромиссы — [ADR-0004](../docs/adr/0004-server-deployment.md).

| Файл                           | Назначение                                                        |
| ------------------------------ | ----------------------------------------------------------------- |
| `../Dockerfile`                | один образ `dentbook-app` для api, worker, миграций и сидов       |
| `docker-compose.yml`           | стек на сервере: postgres, redis, migrate, api, worker            |
| `deploy.sh`                    | выкладка рабочей копии: загрузка → сборка → миграции → перезапуск |
| `nginx/dentbook.conf.template` | nginx перед API: TLS, редирект с HTTP, прокси на `127.0.0.1`      |

## Требования к серверу

- Linux x86_64, root или sudo, Docker Engine 20.10+ и плагин Docker Compose v2+;
- nginx на хосте и certbot — TLS завершается на хосте, не в контейнере;
- свободно: ~1 ГБ RAM, ~2 ГБ диска;
- DNS-запись домена указывает на сервер.

## Разовая подготовка

Команды выполняются на сервере под root. `dentbook.example.com`, `203.0.113.10` — заменить.

### 1. Docker Compose

```bash
docker compose version   # если «'compose' is not a docker command» — поставить плагин:
ver=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/$ver/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose
```

Плагин ставится отдельным файлом и не затрагивает старый `docker-compose` v1, если он есть.

### 2. Каталог и `.env`

Секреты генерируются на сервере и не покидают его.

```bash
umask 077
mkdir -p /opt/dentbook
cat > /opt/dentbook/.env <<EOF
LOG_LEVEL=info
API_HOST_PORT=3100
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
EOF
```

`DATABASE_URL` и `REDIS_URL` собирает `docker-compose.yml`. Без `JWT_SECRET` API не
стартует. Остальные переменные (`TELEGRAM_*`, `SMS_*`, `CAPTCHA_*` — см. `.env.example`)
дописываются в этот же файл: он целиком передаётся контейнерам. На уже
развёрнутом сервере недостающий секрет дописывается так:

```bash
grep -q '^JWT_SECRET=' /opt/dentbook/.env || echo "JWT_SECRET=$(openssl rand -hex 32)" >> /opt/dentbook/.env
```

### 3. Первая выкладка

С рабочей машины — см. «Выкладка» ниже. После неё API отвечает на
`http://127.0.0.1:3100/health` на сервере.

### 4. nginx и SSL

В `listen` нужен тот же адрес, что у остальных сайтов сервера (`grep -rh listen /etc/nginx`).
Если они слушают конкретный IP, а блок DentBook — `80`, nginx отдаст запрос их блоку.

Сначала — только проверка ACME, чтобы получить сертификат:

```bash
mkdir -p /var/www/dentbook-acme
cat > /etc/nginx/conf.d/dentbook.conf <<'EOF'
server {
    listen 203.0.113.10:80;
    server_name dentbook.example.com;
    location ^~ /.well-known/acme-challenge/ { root /var/www/dentbook-acme; }
    location / { return 404; }
}
EOF
nginx -t && systemctl reload nginx

certbot certonly --webroot -w /var/www/dentbook-acme -d dentbook.example.com \
  --non-interactive --agree-tos --deploy-hook "systemctl reload nginx"
```

Затем полный конфиг из шаблона:

```bash
sed -e 's/{{DOMAIN}}/dentbook.example.com/g' \
    -e 's/{{LISTEN_IP}}/203.0.113.10/g' \
    -e 's/{{API_HOST_PORT}}/3100/g' \
    /opt/dentbook/src/deploy/nginx/dentbook.conf.template > /etc/nginx/conf.d/dentbook.conf
nginx -t && systemctl reload nginx
curl https://dentbook.example.com/health
```

Продление — таймер certbot; `--deploy-hook` сохраняется в
`/etc/letsencrypt/renewal/dentbook.example.com.conf` и перезагружает nginx только после
продления этого сертификата. Проверка: `certbot renew --cert-name dentbook.example.com --dry-run`
(без терминала certbot ждёт случайную паузу до 8 минут — это нормально).

На серверах с ISPmanager сайт для этого домена в панели не создавать: панель напишет свой
блок `server` с тем же `server_name`, и nginx выберет один из двух.

### 5. Бот Telegram (§8, ADR-0010)

1. В @BotFather: `/newbot` → имя и username бота → токен. Токен не пересылать в чатах и
   не коммитить — только в `.env` на сервере.
2. Дописать в `/opt/dentbook/.env` (токен вставить вручную):

   ```bash
   cat >> /opt/dentbook/.env <<EOF
   PUBLIC_BASE_URL=https://dentbook.example.com
   TELEGRAM_BOT_USERNAME=dentbook_example_bot
   TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
   TELEGRAM_BOT_TOKEN=
   EOF
   nano /opt/dentbook/.env   # вписать TELEGRAM_BOT_TOKEN=<токен от BotFather>
   ```

3. Перезапустить api и worker и настроить бота — вебхук, кнопку меню Mini App, команды:

   ```bash
   cd /opt/dentbook
   docker compose up -d api worker
   docker compose run --rm --no-deps api node --import tsx apps/api/src/telegram-setup.ts
   ```

   Скрипт печатает адрес вебхука и Mini App. Запускать заново после смены токена или домена.

4. Проверка: в панели — «Врачи» → врач → «Создать ссылку для подключения», открыть ссылку
   или QR-код с телефона врача и нажать «Старт». Карточка переходит в «Подключён», в боте
   появляется кнопка «Schedule».

## Выкладка

```bash
DEPLOY_HOST=root@203.0.113.10 deploy/deploy.sh   # или алиас из ~/.ssh/config
```

Скрипт выкладывает **рабочую копию** (отслеживаемые и новые файлы, без игнорируемых —
`.env` не уходит), собирает образ `dentbook-app:<commit>[-dirty]`, применяет миграции
(сервис `migrate`) и пересоздаёт `api` и `worker`. Вход по SSH — только по ключу: на
серверах с fail2ban серия неудачных попыток закрывает порт 22 для вашего IP.

## Эксплуатация

Из `/opt/dentbook` на сервере:

| Задача                    | Команда                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| состояние                 | `docker compose ps -a`                                                    |
| логи                      | `docker compose logs -f api worker`                                       |
| демо-данные (только тест) | `docker compose run --rm migrate pnpm seed`                               |
| psql                      | `docker compose exec postgres psql -U dentbook -d dentbook`               |
| резервная копия БД        | `docker compose exec -T postgres pg_dump -U dentbook dentbook > dump.sql` |
| остановить                | `docker compose down` (данные остаются в томах)                           |
| удалить вместе с данными  | `docker compose down -v`                                                  |

`docker compose exec` читает stdin: в скриптах, которые сами приходят через stdin
(`ssh host 'bash -s' <<EOF`), добавлять `</dev/null`, иначе команда съест остаток скрипта.

Откат — выкладка нужного коммита: `git switch --detach <commit> && deploy/deploy.sh`.
Миграции только добавляются, поэтому откат кода на схему новее — осознанное решение.

## Тестовый стенд

- `https://dentbook.mashna.am` — общий сервер с другими сайтами (nginx + ISPmanager), каталог
  `/opt/dentbook`, API на `127.0.0.1:3100`, конфиг nginx
  `/etc/nginx/conf.d/dentbook.mashna.am.conf`.
- `https://mashna.am` (и `www.`) — тестовый «сайт клиники» (Q13) с формой записи: страница
  `/var/www/cweb/data/www/mashna.am/index.html` собрана из `apps/widget/test-page` с ключом
  демо-клиники. Конфиг nginx от ISPmanager — `/etc/nginx/vhosts/cweb/mashna.am.conf`,
  сертификат — certbot (`mashna.am`). Прежняя заглушка — в `/root/dentbook-backups/`.
- Демо-клиника «DentBook Demo Clinic» (Нью-Йорк, офис, 3 услуги, 2 врача) — вход в панель и
  ключ формы в `/root/dentbook-demo.txt` на сервере (только root).
- Бот Telegram на стенде выключен, пока нет токена от @BotFather: «Создать ссылку для
  подключения» в панели отвечает, что бот не настроен. Включение — раздел «5. Бот Telegram»
  выше; Mini App — `https://dentbook.mashna.am/miniapp/` (вне Telegram просит открыть его из
  бота).
- SMS и капча на стенде выключены, пока нет ключей Twilio и Turnstile (Q5): форма доходит до
  ввода телефона и сообщает, что онлайн-запись недоступна. Ключи дописываются в
  `/opt/dentbook/.env` (`SMS_PROVIDER=twilio`, `TWILIO_*`, `SMS_SENDER`, `CAPTCHA_*`), затем
  выкладка или `docker compose up -d api`.
- Выкладка: `DEPLOY_HOST=dentbook-test deploy/deploy.sh` (алиас в локальном `~/.ssh/config`).
- Лимиты памяти в `docker-compose.yml` защищают соседние сайты: стек занимает ~120 МБ.
