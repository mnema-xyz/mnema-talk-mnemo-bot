# Mnemo: a small image that runs the TypeScript sources directly with Node 24
# (type stripping, no build step), as an unprivileged user.
#
#   docker build -t mnemo .
#   docker run --env-file .env mnemo

# node:24-alpine, pinned by digest; Dependabot proposes updates.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor/ ./vendor/
# Production dependencies only; no install scripts run.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4
ENV NODE_ENV=production \
    MNEMO_DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json mnemo.manifest.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
# The health endpoint listens on 127.0.0.1:8080 inside the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "src/main.ts"]
