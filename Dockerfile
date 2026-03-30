# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile — shapeguard example app
#
# Multi-stage build:
#   builder — installs deps, builds the library
#   example — runs the with-openapi example app
#
# Usage:
#   docker build -t shapeguard-example .
#   docker run -p 3000:3000 shapeguard-example
#   open http://localhost:3000/docs
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

LABEL org.opencontainers.image.title="shapeguard"
LABEL org.opencontainers.image.description="FastAPI-style validation for Express"
LABEL org.opencontainers.image.source="https://github.com/kalyankashaboina/shapeguard"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Copy manifests first — better Docker layer caching
COPY package.json package-lock.json ./

# Install all deps (including devDeps for build)
RUN npm ci --ignore-scripts

# Copy source and build
COPY src/       ./src/
COPY tsconfig.json tsup.config.ts ./

RUN npm run build

# Prune to production deps only
RUN npm prune --production

# ── Stage 2: example runner ───────────────────────────────────────────────────
FROM node:20-alpine AS example

WORKDIR /app

# Copy built library
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy example app
COPY examples/with-openapi/ ./example/

WORKDIR /app/example

# Install example deps
RUN npm install

ENV NODE_ENV=production
ENV PORT=3000

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S shapeguard -u 1001 -G nodejs
USER shapeguard

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/docs/openapi.json | grep -q '"openapi"' || exit 1

CMD ["node", "--import", "tsx/esm", "src/index.ts"]
