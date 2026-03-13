# --- Stage 1: Builder ---
FROM node:22-alpine AS builder
WORKDIR /app

# 安裝依賴（利用 Docker layer cache）
COPY package.json package-lock.json turbo.json ./
COPY packages/core/package.json packages/core/
COPY packages/collector/package.json packages/collector/
COPY packages/db/package.json packages/db/
COPY packages/export/package.json packages/export/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci

# 複製原始碼
COPY packages/ packages/
COPY apps/ apps/

# Build frontend
RUN cd apps/web && npx vite build

# --- Stage 2: API Server ---
FROM node:22-alpine AS api
WORKDIR /app
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages packages
COPY --from=builder /app/apps/api apps/api
COPY --from=builder /app/apps/web/dist apps/api/public
COPY --from=builder /app/package.json .
COPY --from=builder /app/turbo.json .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]

# --- Stage 3: Worker ---
FROM node:22-alpine AS worker
WORKDIR /app
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages packages
COPY --from=builder /app/apps/worker apps/worker
COPY --from=builder /app/package.json .
COPY --from=builder /app/turbo.json .

ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]
