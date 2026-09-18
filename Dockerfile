# Один образ для api, worker и разовых задач (миграции, сиды) — ADR-0004.
FROM node:22-alpine

WORKDIR /app
ENV CI=true

# Версия совпадает с packageManager в package.json
RUN npm install -g pnpm@11.15.1

COPY . .

# devDependencies нужны в образе: drizzle-kit (миграции) и tsx (запуск, сиды).
# Хранилище pnpm после установки не нужно — удаляется в том же слое.
RUN pnpm install --frozen-lockfile \
  && rm -rf "$(pnpm store path)"

# Админка, форма записи и Mini App — статика, её раздаёт API на /admin/, /widget/ и
# /miniapp/ (Q14)
RUN pnpm --filter @dentbook/admin build \
  && pnpm --filter @dentbook/widget size \
  && pnpm --filter @dentbook/miniapp build
ENV ADMIN_DIST_DIR=/app/apps/admin/dist \
    WIDGET_DIST_DIR=/app/apps/widget/dist \
    MINIAPP_DIST_DIR=/app/apps/miniapp/dist

ENV NODE_ENV=production
USER node

CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
