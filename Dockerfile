FROM node:20-alpine AS builder
RUN apk add --no-cache git
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter frontend build \
 && pnpm --filter backend build \
 && pnpm --filter backend --prod --legacy deploy /out

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/package.json ./package.json
COPY --from=builder /out/dist ./dist
COPY --from=builder /out/public ./public

RUN mkdir -p /app/sessions

EXPOSE 3001
CMD ["node", "dist/index.js"]
