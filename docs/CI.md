# CI/CD Pipelines

This repository uses GitHub Actions for continuous integration, container publishing, security scanning, and documentation deployment. Dependabot keeps dependencies up to date automatically.

## Workflows Overview

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| CI | `ci.yml` | PRs to `main`/`ai/main`, push to `ai/main` | Build, unit + integration tests |
| Release | `release.yml` | Push to `main` | Version bumps and npm publish |
| Publish Containers | `publish-containers.yml` | Push to `main`, release published | Build/scan/push Docker images |
| Docs | `docs.yml` | Push to `main` | Deploy Storybook to GitHub Pages |
| CodeQL | `codeql.yml` | Push/PR to `main` | Security analysis |

## CI (`ci.yml`)

Runs on every pull request targeting `main` or `ai/main`, and on every push to `ai/main`. Two jobs:

- **`test`**: checkout, setup Node 22 + pnpm, `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm test:coverage` (lib, with coverage thresholds enforced), followed by dedicated steps for `map-client` (`vitest run`), `admin-app` (`vitest run --coverage`), and `ingest-service` (`pnpm --filter ingest-service test`) — these app/sidecar suites aren't covered by the root `pnpm test`.
- **`ingest-integration`**: spins up a `postgis/postgis` service container and runs `apps/ingest-service/src/ingest.integration.test.ts` against real `ogr2ogr`/GDAL and PostGIS (`INGEST_INTEGRATION=1`).

Concurrency is set to cancel in-progress runs for the same branch, so pushing new commits to a PR cancels the previous run.

## Release (`release.yml`)

Automates versioning and npm publishing using [Changesets](https://github.com/changesets/changesets). Runs on every push to `main`.

- If pending changesets exist, the workflow creates a **"Version Packages"** PR that bumps versions and updates changelogs.
- When that PR is merged, the workflow publishes the updated packages to npm and creates GitHub Releases.

See [PUBLISHING.md](PUBLISHING.md) for the full development and release workflow.

## Container Publishing (`publish-containers.yml`)

Builds and publishes Docker images to GitHub Container Registry (ghcr.io) on push to `main` and on release.

**Images built** (matrix strategy):

| Image | Dockerfile | Build args |
|-------|-----------|------------|
| `ghcr.io/ogc-maps/map-admin` | `apps/admin-app/Dockerfile` | `VITE_BASE_PATH=/admin/` |
| `ghcr.io/ogc-maps/map-client` | `apps/map-client/Dockerfile` | — |
| `ghcr.io/ogc-maps/map-gateway` | `docker/gateway/Dockerfile` | — |

**Tagging**:
- Every push to `main`: tagged with short commit SHA
- On release: tagged with the version number and `latest`

**Security scanning**: Each image is scanned with [Trivy](https://github.com/aquasecurity/trivy) for CRITICAL and HIGH severity vulnerabilities. The build fails if vulnerabilities are found (unfixed issues are ignored). Scan results are uploaded as SARIF to the GitHub Security tab.

**Caching**: Uses GitHub Actions cache (`type=gha`) scoped per image for faster rebuilds.

## Storybook Docs (`docs.yml`)

Deploys the Storybook documentation site to GitHub Pages on every push to `main`.

**Steps**: checkout, setup Node 22 + pnpm, install, `pnpm --filter @ogc-maps/storybook-components build-storybook`, upload and deploy to Pages.

The built output is read from `packages/map-ui-lib/storybook-static`.

## CodeQL (`codeql.yml`)

Runs GitHub's CodeQL static analysis on pushes and pull requests to `main`. Scans JavaScript/TypeScript code for security vulnerabilities. Results appear in the repository's **Security > Code scanning** tab.

## Dependabot

Configured in `.github/dependabot.yml` to create weekly PRs for:

| Ecosystem | Directory | What it updates |
|-----------|-----------|-----------------|
| npm | `/` | Node.js package dependencies across the monorepo |
| github-actions | `/` | Action versions in workflow files |
| docker | `/apps/admin-app` | Base image in admin-app Dockerfile |
| docker | `/apps/map-client` | Base image in map-client Dockerfile |

Dependabot PRs go through the same CI checks as any other PR. Review and merge them regularly to stay current.

## Required Secrets and Permissions

| Secret | Used by | Purpose |
|--------|---------|---------|
| `NPM_TOKEN` | `release.yml` | Automation token for publishing to npm |
| `GITHUB_TOKEN` | All workflows | Automatically provided; must have **"Allow GitHub Actions to create and approve pull requests"** enabled (Settings > Actions > General > Workflow permissions) for the release workflow to create Version Packages PRs |
