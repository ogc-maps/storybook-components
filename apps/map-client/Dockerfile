# Stage 1: Builder
FROM node:26-alpine AS builder
RUN corepack enable

WORKDIR /app

# Copy workspace manifest files for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
# Patched deps referenced by root package.json (pnpm patchedDependencies) must
# be present before install, or `pnpm install --frozen-lockfile` errors.
COPY patches/ ./patches/
COPY packages/map-ui-lib/package.json ./packages/map-ui-lib/
COPY apps/map-client/package.json ./apps/map-client/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/map-ui-lib/ ./packages/map-ui-lib/
COPY apps/map-client/ ./apps/map-client/

# Build lib then app
RUN pnpm --filter @ogc-maps/storybook-components build
RUN pnpm --filter map-client build

# Stage 2: Runtime
FROM nginx:alpine AS runtime
# Bump APK_REVISION (YYYY-MM-DD) to force a fresh apk index past the buildx layer
# cache when a base-image package CVE needs the upgrade applied.
ARG APK_REVISION=2026-06-17
RUN echo "apk revision: $APK_REVISION" \
  && apk update \
  && apk upgrade --no-cache \
  && rm -rf /var/cache/apk/*

# Copy SPA fallback nginx config
COPY apps/map-client/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built SPA from builder
COPY --from=builder /app/apps/map-client/dist/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
