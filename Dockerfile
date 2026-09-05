# Multi-stage Dockerfile for rarebreed-ts
# Replaces: Jib / Maven Docker plugin
# Final image: ~50-80MB (vs Java's ~200-300MB)

# ─── Stage 1: BUILD ───────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Layer caching: deps change less often than source code
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Compile TypeScript (like gradle compileJava)
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

# ─── Stage 2: PRODUCTION ──────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install ffmpeg for server-side transcoding (MKV → HLS)
RUN apk add --no-cache ffmpeg

# Non-root user (security best practice)
RUN addgroup -S app && adduser -S app -G app

# Production deps only (no devDependencies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm && pnpm install --prod --frozen-lockfile --ignore-scripts

# Compiled output + static assets
COPY --from=build /app/dist ./dist
COPY public/ ./public/

# Create cache directories (writable by app user)
RUN mkdir -p cache/video cache/transcode exports && chown -R app:app cache exports

USER app

EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
