# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist/browser /usr/share/nginx/html
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 8080

# nginx's own image entrypoint runs everything in /docker-entrypoint.d, so the
# runtime config is written before the server starts. Nothing in this image is
# environment-specific until then: one image, any environment.
