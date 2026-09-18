#!/usr/bin/env bash
# Выкладка рабочей копии на сервер: исходники → сборка образа → миграции → перезапуск.
# Разовая подготовка сервера — deploy/README.md.
#
#   DEPLOY_HOST=dentbook-test deploy/deploy.sh
#
# DEPLOY_HOST — хост или алиас из ~/.ssh/config; DEPLOY_DIR — каталог на сервере.
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is required, e.g. root@203.0.113.10 or an ~/.ssh/config alias}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/dentbook}"

cd "$(git rev-parse --show-toplevel)"

tag="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  tag="${tag}-dirty"
fi

# Отслеживаемые и новые файлы без игнорируемых: .env и node_modules на сервер не уходят
echo "==> upload sources (${tag})"
git ls-files -z --cached --others --exclude-standard \
  | tar --null --ignore-failed-read -T - -czf - \
  | ssh "$DEPLOY_HOST" "set -e
      rm -rf '$DEPLOY_DIR/src.new'
      mkdir -p '$DEPLOY_DIR/src.new'
      tar -xzf - -C '$DEPLOY_DIR/src.new'
      rm -rf '$DEPLOY_DIR/src'
      mv '$DEPLOY_DIR/src.new' '$DEPLOY_DIR/src'"

echo "==> build image, migrate, restart"
# Скрипт приходит в bash через stdin. Тело — в функции, которая запускается с
# stdin из /dev/null: иначе docker прочитает из stdin остаток скрипта.
ssh "$DEPLOY_HOST" "DEPLOY_DIR='$DEPLOY_DIR' TAG='$tag' bash -s" <<'REMOTE'
set -euo pipefail

main() {
  cd "$DEPLOY_DIR"
  if [ ! -f .env ]; then
    echo "$DEPLOY_DIR/.env is missing — see deploy/README.md" >&2
    exit 1
  fi

  docker build --pull -t "dentbook-app:$TAG" -t dentbook-app:latest src
  cp src/deploy/docker-compose.yml docker-compose.yml
  export DENTBOOK_IMAGE_TAG="$TAG"

  # Сторонние образы качает docker pull, а не compose: на серверах с установленным
  # docker-credential-secretservice без D-Bus compose падает на поиске учётных данных
  docker compose config --images | { grep -v '^dentbook-app:' || true; } | xargs -r -n1 docker pull -q

  # Смена тега меняет конфигурацию сервисов — compose пересоздаёт контейнеры
  docker compose up -d --pull never --remove-orphans --wait

  # Старые сборки не копятся: остаются текущая и latest; безымянные убирает prune
  docker images dentbook-app --format '{{.Tag}}' \
    | { grep -vxE "latest|<none>|$TAG" || true; } \
    | xargs -r -I{} docker rmi "dentbook-app:{}" >/dev/null
  docker image prune -f >/dev/null

  docker compose ps
}

main </dev/null
REMOTE

echo "==> deployed ${tag}"
