# syntax=docker/dockerfile:1.7
#
# API image for the CPRU publishing-fee system.
#
# Stages:
#   base     shared OS layer (openssl for the Prisma engine, tzdata)
#   dev      all dependencies, source bind-mounted, hot reload
#   build    compiles TypeScript to dist/
#   fonts    collects the Sarabun faces pdfmake needs
#   runtime  production image: prod dependencies + dist + fonts only
#
# Debian slim rather than Alpine: Prisma picks its engine from the OS it is
# generated on, and schema.prisma targets the default (glibc) platform.

ARG NODE_VERSION=22

# ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Bangkok
WORKDIR /app

# ---------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
# Source arrives through a bind mount (see docker-compose.dev.yml), which also
# brings docker/dev-entrypoint.sh. It is invoked through sh so a missing execute
# bit on a Windows checkout does not matter; .gitattributes keeps it LF.
EXPOSE 3000
CMD ["sh", "docker/dev-entrypoint.sh"]

# ---------------------------------------------------------------
FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------
FROM base AS fonts
# Set to false for offline builds; supply the TTFs in assets/fonts/ instead.
ARG FETCH_FONTS=true
COPY assets/fonts ./assets/fonts
COPY scripts/fetch-fonts.mjs ./scripts/fetch-fonts.mjs
RUN if [ "$FETCH_FONTS" = "true" ]; then node scripts/fetch-fonts.mjs; \
    else echo "[fonts] download skipped"; fi

# ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/app/storage/uploads

COPY package.json package-lock.json ./
COPY prisma ./prisma
# prisma is a production dependency so the container can run migrate deploy.
RUN npm ci --omit=dev \
 && node_modules/.bin/prisma generate \
 && npm cache clean --force

COPY app.js ./
COPY --from=build /app/dist ./dist
COPY --from=fonts /app/assets/fonts ./assets/fonts
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Strip CRLF in case the script was checked out on Windows, then create the
# upload directory outside the web root and hand it to the unprivileged user.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
 && chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/storage/uploads \
 && chown -R node:node /app/storage

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
