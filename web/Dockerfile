# syntax=docker/dockerfile:1.7
#
# Web image for the CPRU publishing-fee system.
#
# Stages:
#   dev      Vite dev server with hot reload, source bind-mounted
#   build    type-checks and builds the static bundle
#   runtime  unprivileged nginx serving the bundle and proxying /api

ARG NODE_VERSION=22

# ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
ENV VITE_HOST=0.0.0.0
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Service name and port of the API on the compose network.
ENV API_UPSTREAM=api:3000

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
