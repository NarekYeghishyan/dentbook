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

ENV NODE_ENV=production
USER node

CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
