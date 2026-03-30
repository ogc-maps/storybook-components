# Stage 1: Builder
FROM node:22-alpine AS builder
RUN corepack enable

WORKDIR /app

# Copy workspace manifest files for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/map-ui-lib/package.json ./packages/map-ui-lib/
COPY apps/admin-app/package.json ./apps/admin-app/
COPY apps/map-client/package.json ./apps/map-client/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/map-ui-lib/ ./packages/map-ui-lib/
COPY apps/admin-app/ ./apps/admin-app/

# Build lib then admin-ui SPA then server
ARG VITE_BASE_PATH=/admin/
ENV VITE_BASE_PATH=$VITE_BASE_PATH

RUN pnpm --filter @ogc-maps/storybook-components build
RUN pnpm --filter admin-app build
RUN pnpm --filter admin-app build:server

# Stage 2: Runtime
FROM node:22-alpine AS runtime
RUN apk update && apk upgrade --no-cache
RUN corepack enable

WORKDIR /app

# Copy workspace manifest files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/map-ui-lib/package.json ./packages/map-ui-lib/
COPY apps/admin-app/package.json ./apps/admin-app/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy built SPA + server from builder
COPY --from=builder /app/packages/map-ui-lib/dist/ ./packages/map-ui-lib/dist/
COPY --from=builder /app/apps/admin-app/dist/ ./apps/admin-app/dist/
COPY --from=builder /app/apps/admin-app/dist-server/ ./apps/admin-app/dist-server/

WORKDIR /app/apps/admin-app

EXPOSE 3001

CMD ["node", "dist-server/index.js"]
