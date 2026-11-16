FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY packages/core ./packages/core
COPY apps/api ./apps/api

RUN pnpm --filter @qris-dinamis/core build && pnpm --filter @qris-dinamis/api build
RUN CI=true pnpm prune --prod

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

RUN mkdir -p /app/apps/api/data && chown -R appuser:appgroup /app

WORKDIR /app/apps/api
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/index.js"]
