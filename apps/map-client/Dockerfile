# Stage 1: Builder
FROM node:22-alpine AS builder
RUN corepack enable

WORKDIR /app

# Copy workspace manifest files for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
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
RUN apk update && apk upgrade --no-cache

# Copy SPA fallback nginx config
COPY apps/map-client/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built SPA from builder
COPY --from=builder /app/apps/map-client/dist/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
