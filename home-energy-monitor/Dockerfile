# https://developers.home-assistant.io/docs/apps/configuration#app-dockerfile
ARG BUILD_FROM=node:24-alpine

# ---------------------------------------------------------------------------
# Stage 1 - build the frontend bundle and compile the TypeScript server
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM} AS build

WORKDIR /build

# Install the full dependency tree (including dev dependencies) from the
# lockfile so builds are reproducible.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY server ./server
COPY web ./web

RUN npm run build

# Produce a production-only node_modules tree for the runtime stage.
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2 - minimal runtime, no build tooling
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM} AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    # Keep the V8 heap small; this runs alongside Home Assistant on a
    # Raspberry Pi 3 with 1 GB of RAM.
    NODE_OPTIONS=--max-old-space-size=96

WORKDIR /app

COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY package.json ./

EXPOSE 3000

CMD ["node", "dist/server/index.js"]

LABEL \
    org.opencontainers.image.title="Home Assistant App: Home Energy Monitor" \
    org.opencontainers.image.description="A better appliance energy dashboard for Home Assistant" \
    org.opencontainers.image.source="https://github.com/alexanderdodd/energy-monitor" \
    org.opencontainers.image.licenses="MIT"
