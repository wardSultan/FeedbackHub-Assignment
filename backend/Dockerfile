# syntax=docker/dockerfile:1

# ---- dependencies -----------------------------------------------------------
# Separated from the build so that a source-only change does not reinstall
# node_modules. npm ci rather than npm install: the lockfile is the input.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# Reinstall without dev dependencies. Done here rather than in the runtime stage
# so npm never has to exist in the final image.
RUN npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production

# dumb-init is PID 1 so SIGTERM reaches Node rather than being swallowed by the
# shell. Without it a rolling update kills connections instead of draining them.
RUN apk add --no-cache dumb-init

WORKDIR /app

# node:22-alpine already ships an unprivileged `node` user; reusing it is simpler
# and less error-prone than creating another.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000

# Liveness only checks the process. Readiness, which checks the database, is the
# orchestrator's job — a container that restarts itself when Postgres blinks turns a
# recoverable dependency failure into a crash loop.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
