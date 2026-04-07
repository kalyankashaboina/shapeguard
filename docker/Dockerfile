# ─────────────────────────────────────────────────────────────────────────────
# docker/Dockerfile — shapeguard example app
#
# Multi-stage build — keeps the final image as small as possible.
#
# Stages:
#   deps    — install all dependencies with cache mount
#   builder — compile TypeScript → dist/
#   example — minimal runtime image with non-root user
#
# Usage (from repo root):
#   docker build -f docker/Dockerfile -t shapeguard-example .
#   docker run -p 3000:3000 shapeguard-example
#
# Or with Compose (from repo root):
#   docker compose -f docker/docker-compose.yml up
#
# Then open:
#   http://localhost:3000/docs              → Swagger UI (dark theme)
#   http://localhost:3000/docs/openapi.json → raw OpenAPI 3.1 spec
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: deps — install with layer cache ─────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first — Docker caches this layer until package.json changes
COPY package.json package-lock.json ./

# Clean install — reproducible, no package-lock drift
RUN npm ci --ignore-scripts

# ── Stage 2: builder — compile TypeScript ────────────────────────────────────
FROM node:20-alpine AS builder

LABEL org.opencontainers.image.title="shapeguard"
LABEL org.opencontainers.image.description="FastAPI-style validation, response shaping and error handling for Express"
LABEL org.opencontainers.image.source="https://github.com/kalyankashaboina/shapeguard"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="Kalyan Kashaboina"

WORKDIR /app

# Copy installed deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Copy source and build config
COPY src/          ./src/
COPY tsconfig.json tsup.config.ts ./

# Build the library → dist/
RUN npm run build

# Prune dev dependencies — final image needs prod deps only
RUN npm prune --production

# ── Stage 3: example — minimal production runner ──────────────────────────────
FROM node:20-alpine AS example

WORKDIR /app

# Metadata on final image
LABEL org.opencontainers.image.title="shapeguard-example"
LABEL org.opencontainers.image.description="shapeguard with-openapi example — Swagger UI included"

# Copy built library and production deps from builder
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy example application
COPY examples/with-openapi/ ./example/

WORKDIR /app/example

# Install example-specific deps
RUN npm install --production 2>/dev/null || true

# ── Security: run as non-root ─────────────────────────────────────────────────
RUN addgroup -g 1001 -S nodejs \
 && adduser  -S shapeguard -u 1001 -G nodejs \
 && chown -R shapeguard:nodejs /app

USER shapeguard

# ── Runtime config ────────────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check — verifies Swagger UI spec endpoint responds
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/docs/openapi.json | grep -q '"openapi"' || exit 1

CMD ["node", "dist/index.js"]
