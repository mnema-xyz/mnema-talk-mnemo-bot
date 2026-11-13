# Mnemo: a small image that runs the TypeScript sources directly with Node 24
# (type stripping, no build step), as an unprivileged user.
#
#   docker build -t mnemo .
#   docker run --env-file .env mnemo

# node:24-alpine, pinned by digest; Dependabot proposes updates.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production dependencies only; no install scripts run.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ENV NODE_ENV=production \
    MNEMO_DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json mnemo.manifest.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data
# The uid of the image's "node" user.
USER 1000:1000
VOLUME ["/data"]
# The health endpoint listens on 127.0.0.1:8080 inside the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
STOPSIGNAL SIGTERM
CMD ["node", "src/main.ts"]
