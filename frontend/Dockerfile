# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./

RUN npm ci


FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./

RUN npm run build


FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist/browser /usr/share/nginx/html

COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh

RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 8080