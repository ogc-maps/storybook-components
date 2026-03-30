import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import { pool, initDb } from './db.js';
import { inspectSource, normalizeUrl } from './inspect.js';
import { detectTileSourceType, appendAuth, authHeaders } from '@ogc-maps/storybook-components/hooks';
import type { SourceAuth } from '@ogc-maps/storybook-components/hooks';
import { safeValidateMapConfig } from '@ogc-maps/storybook-components/schemas';

// Shared shape for source create/update request bodies
interface SourceRequestBody {
  source_id?: string;
  url?: string;
  label?: string;
  tile_matrix_set_id?: string;
  source_type?: string;
  auth?: SourceAuth | null;
  metadata?: unknown;
  proxy?: boolean;
}

// URL helpers for proxy rewriting
const ORIGIN_RE = /^(https?:\/\/[^/?#]+)/;

function extractOrigin(url: string): string {
  return url.match(ORIGIN_RE)?.[1] ?? url.replace(/\/$/, '');
}

function extractUrlPath(url: string): string {
  return (url.match(/^https?:\/\/[^/?#]+(.*?)(?:\?.*)?$/)?.[1] ?? '').replace(/\/$/, '');
}

function stripQueryParams(url: string, paramNames: Set<string>): string {
  if (paramNames.size === 0) return url;
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return url;
  const base = url.substring(0, qIdx);
  const params = new URLSearchParams(url.substring(qIdx + 1));
  for (const name of paramNames) params.delete(name);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// Augment session with our custom fields
declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
  }
}

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

const PgSession = connectPgSimple(session);

// Trust first proxy (gateway nginx) so secure cookies work behind reverse proxy
app.set('trust proxy', 1);

const corsOrigins = process.env.CORS_ORIGINS;
app.use(cors({
  credentials: true,
  origin: corsOrigins ? corsOrigins.split(',').map(o => o.trim()) : true,
}));
app.use(express.json({ limit: '1mb' }));

// Session middleware
app.use(
  session({
    store: new PgSession({
      pool,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  }),
);

// --- Helpers ---

function handleServerError(res: express.Response, err: unknown): void {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

// --- Auth middleware ---

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  // If no password hash configured, skip auth (dev mode)
  if (!process.env.ADMIN_PASSWORD_HASH) {
    next();
    return;
  }
  if (!req.session.authenticated) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// --- Auth endpoints (public) ---

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!process.env.ADMIN_PASSWORD_HASH) {
    // Auth not configured — set session anyway for consistency
    req.session.authenticated = true;
    req.session.username = username ?? 'dev';
    res.json({ ok: true });
    return;
  }

  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  const expectedUsername = process.env.ADMIN_USERNAME ?? 'admin';
  if (username !== expectedUsername) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  try {
    const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ ok: true });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!process.env.ADMIN_PASSWORD_HASH) {
    // 501 = auth not configured (client treats this as "open access")
    res.status(501).json({ configured: false });
    return;
  }
  if (!req.session.authenticated) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({ username: req.session.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// --- Health check ---

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(503).json({ status: 'error' });
  }
});

const NAME_REGEX = /^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/;
const RESERVED_CONFIG_NAMES = new Set(['admin', 'api', 'ogc']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

/** Returns an error message if the name is invalid, or null if valid. */
function validateConfigName(name: string | undefined, required: true): string | null;
function validateConfigName(name: string | undefined): string | null;
function validateConfigName(name: string | undefined, required?: boolean): string | null {
  if (name === undefined) return required ? 'name is required' : null;
  if (!NAME_REGEX.test(name)) {
    return 'name must contain only letters, numbers, and hyphens (e.g. "My-Config")';
  }
  if (RESERVED_CONFIG_NAMES.has(name.toLowerCase())) {
    return `"${name}" is a reserved name and cannot be used`;
  }
  return null;
}

// --- Config endpoints ---

// GET /api/configs — list all configs
app.get('/api/configs', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, is_published, is_default, created_at, updated_at FROM map_configs ORDER BY updated_at DESC',
    );
    res.json(result.rows);
  } catch (err) {
    handleServerError(res, err);
  }
});

// GET /api/configs/published — list published configs
app.get('/api/configs/published', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, is_default FROM map_configs WHERE is_published = true ORDER BY name',
    );
    res.json(result.rows);
  } catch (err) {
    handleServerError(res, err);
  }
});

// GET /api/configs/:id — get by UUID or by published name
app.get('/api/configs/:id', async (req, res) => {
  try {
    if (UUID_REGEX.test(req.params.id)) {
      // UUID lookup — return full config row
      const result = await pool.query('SELECT * FROM map_configs WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Config not found' });
        return;
      }
      res.json(result.rows[0]);
    } else {
      // Name lookup — return just the config JSON for published configs
      let result;
      if (req.params.id === 'default') {
        // Resolve "default" to the config marked as default
        result = await pool.query(
          'SELECT config FROM map_configs WHERE is_default = true AND is_published = true',
        );
      } else {
        result = await pool.query(
          'SELECT config FROM map_configs WHERE name = $1 AND is_published = true',
          [req.params.id],
        );
      }
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Config not found' });
        return;
      }

      // Rewrite proxied source URLs so the client uses the proxy endpoint
      const config = (result.rows[0] as { config: Record<string, unknown> }).config;
      const sources = config.sources as Array<{ id: string; url: string; auth?: unknown }> | undefined;
      if (sources && sources.length > 0) {
        const sourceIds = sources.map(s => s.id);
        const proxied = await pool.query(
          'SELECT source_id, url, auth FROM ogc_sources WHERE source_id = ANY($1) AND proxy = true',
          [sourceIds],
        );
        if (proxied.rows.length > 0) {
          // Build lookup with pre-computed origin + params-to-strip per source
          const proxiedSources = new Map<string, { url: string; origin: string; auth: SourceAuth | null; paramsToStrip: Set<string> }>();
          for (const r of proxied.rows as Array<{ source_id: string; url: string; auth: SourceAuth | null }>) {
            const paramsToStrip = new Set<string>();
            if (r.auth?.name) paramsToStrip.add(r.auth.name);
            const qIdx = r.url.indexOf('?');
            if (qIdx !== -1) {
              for (const [name] of new URLSearchParams(r.url.substring(qIdx + 1))) {
                paramsToStrip.add(name);
              }
            }
            proxiedSources.set(r.source_id, { url: r.url, origin: extractOrigin(r.url), auth: r.auth, paramsToStrip });
          }

          const proxyBase = `${req.protocol}://${req.get('host')}/api/proxy`;

          for (const source of sources) {
            if (proxiedSources.has(source.id)) {
              source.url = `${proxyBase}/${source.id}${extractUrlPath(proxiedSources.get(source.id)!.url)}`;
              delete source.auth;
            }
          }

          // Rewrite imagery layer tileUrlTemplates that reference proxied sources
          const imageryLayers = config.imageryLayers as Array<{ sourceId?: string; tileUrlTemplate?: string }> | undefined;
          if (imageryLayers) {
            for (const layer of imageryLayers) {
              if (!layer.tileUrlTemplate || !layer.sourceId) continue;
              const sourceInfo = proxiedSources.get(layer.sourceId);
              if (!sourceInfo) continue;

              const tileOrigin = extractOrigin(layer.tileUrlTemplate);
              // Only rewrite if tile URL shares the same origin as the source (SSRF protection)
              if (tileOrigin !== sourceInfo.origin) continue;

              const cleanTileUrl = stripQueryParams(layer.tileUrlTemplate, sourceInfo.paramsToStrip);
              layer.tileUrlTemplate = `${proxyBase}/${layer.sourceId}${cleanTileUrl.substring(tileOrigin.length)}`;
            }
          }
        }
      }

      res.json(config);
    }
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/configs — create new config (protected)
app.post('/api/configs', requireAuth, async (req, res) => {
  const { name, description, config } = req.body as {
    name: string;
    description?: string;
    config?: unknown;
  };
  const nameError = validateConfigName(name, true);
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }

  if (config) {
    const validation = safeValidateMapConfig(config);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid config', details: validation.error.issues });
      return;
    }
  }

  try {
    const result = await pool.query(
      'INSERT INTO map_configs (name, description, config) VALUES ($1, $2, $3) RETURNING *',
      [name, description ?? null, JSON.stringify(config ?? {})],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// PUT /api/configs/:id — update config, snapshot current state as a version (protected)
app.put('/api/configs/:id', requireAuth, async (req, res) => {
  const { name, description, config } = req.body as {
    name?: string;
    description?: string;
    config?: unknown;
  };

  const nameError = validateConfigName(name);
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }

  if (config) {
    const validation = safeValidateMapConfig(config);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid config', details: validation.error.issues });
      return;
    }
  }

  try {
    const existing = await pool.query('SELECT * FROM map_configs WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }

    const row = existing.rows[0] as {
      name: string;
      description: string | null;
      config: unknown;
    };

    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      // Snapshot current state into version history
      const versionResult = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM config_versions WHERE config_id = $1',
        [req.params.id],
      );
      const nextVersion = (versionResult.rows[0] as { next_version: number }).next_version;
      await client.query(
        `INSERT INTO config_versions (config_id, version_number, name, description, config, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.params.id,
          nextVersion,
          row.name,
          row.description,
          JSON.stringify(row.config),
          req.session.username ?? null,
        ],
      );
      result = await client.query(
        'UPDATE map_configs SET name = $1, description = $2, config = $3, updated_at = now() WHERE id = $4 RETURNING *',
        [
          name ?? row.name,
          description ?? row.description,
          JSON.stringify(config ?? row.config),
          req.params.id,
        ],
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// DELETE /api/configs/:id (protected)
app.delete('/api/configs/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM map_configs WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    res.json({ deleted: req.params.id });
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/configs/:id/publish (protected)
app.post('/api/configs/:id/publish', requireAuth, async (req, res) => {
  try {
    const configResult = await pool.query(
      'SELECT name FROM map_configs WHERE id = $1',
      [req.params.id],
    );
    if (configResult.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    const { name } = configResult.rows[0] as { name: string };

    // Check for name conflict among published configs
    const conflict = await pool.query(
      'SELECT id FROM map_configs WHERE name = $1 AND is_published = true AND id != $2',
      [name, req.params.id],
    );
    if (conflict.rows.length > 0) {
      res.status(409).json({ error: `A published config named "${name}" already exists` });
      return;
    }

    const result = await pool.query(
      'UPDATE map_configs SET is_published = true, updated_at = now() WHERE id = $1 RETURNING *',
      [req.params.id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/configs/:id/unpublish — unpublish a config (protected)
app.post('/api/configs/:id/unpublish', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE map_configs SET is_published = false, is_default = false, updated_at = now() WHERE id = $1 RETURNING *',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/configs/:id/set-default — mark a published config as the default (protected)
app.post('/api/configs/:id/set-default', requireAuth, async (req, res) => {
  try {
    const configResult = await pool.query(
      'SELECT id, is_published FROM map_configs WHERE id = $1',
      [req.params.id],
    );
    if (configResult.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    const { is_published } = configResult.rows[0] as { is_published: boolean };
    if (!is_published) {
      res.status(400).json({ error: 'Config must be published before setting as default' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Unset any existing default
      await client.query(
        'UPDATE map_configs SET is_default = false, updated_at = now() WHERE is_default = true',
      );
      // Set the new default
      const result = await client.query(
        'UPDATE map_configs SET is_default = true, updated_at = now() WHERE id = $1 RETURNING *',
        [req.params.id],
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/configs/:id/unset-default — remove default flag (protected)
app.post('/api/configs/:id/unset-default', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE map_configs SET is_default = false, updated_at = now() WHERE id = $1 RETURNING *',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// GET /api/configs/:id/versions — list version history
app.get('/api/configs/:id/versions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, version_number, name, created_by, created_at
       FROM config_versions WHERE config_id = $1
       ORDER BY version_number DESC`,
      [req.params.id],
    );
    res.json(result.rows);
  } catch (err) {
    handleServerError(res, err);
  }
});

// GET /api/configs/:id/versions/:versionId — full version detail
app.get('/api/configs/:id/versions/:versionId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM config_versions WHERE id = $1 AND config_id = $2',
      [req.params.versionId, req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/configs/:id/restore/:versionId — restore a version (protected)
app.post('/api/configs/:id/restore/:versionId', requireAuth, async (req, res) => {
  try {
    const configResult = await pool.query('SELECT * FROM map_configs WHERE id = $1', [
      req.params.id,
    ]);
    if (configResult.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }

    const versionResult = await pool.query(
      'SELECT * FROM config_versions WHERE id = $1 AND config_id = $2',
      [req.params.versionId, req.params.id],
    );
    if (versionResult.rows.length === 0) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    const current = configResult.rows[0] as {
      name: string;
      description: string | null;
      config: unknown;
    };
    const version = versionResult.rows[0] as {
      name: string;
      description: string | null;
      config: unknown;
    };

    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      // Snapshot current state before overwriting
      const versionCountResult = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM config_versions WHERE config_id = $1',
        [req.params.id],
      );
      const nextVersion = (versionCountResult.rows[0] as { next_version: number }).next_version;
      await client.query(
        `INSERT INTO config_versions (config_id, version_number, name, description, config, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.params.id,
          nextVersion,
          current.name,
          current.description,
          JSON.stringify(current.config),
          req.session.username ?? null,
        ],
      );
      // Restore version data
      result = await client.query(
        'UPDATE map_configs SET name = $1, description = $2, config = $3, updated_at = now() WHERE id = $4 RETURNING *',
        [version.name, version.description, JSON.stringify(version.config), req.params.id],
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// --- Source endpoints ---

const SOURCE_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// GET /api/sources — list all saved sources
app.get('/api/sources', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ogc_sources ORDER BY updated_at DESC',
    );
    res.json(result.rows);
  } catch (err) {
    handleServerError(res, err);
  }
});

// GET /api/sources/:id — get single source by UUID
app.get('/api/sources/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ogc_sources WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// GET /api/sources/:id/usage — list configs using this source
app.get('/api/sources/:id/usage', async (req, res) => {
  try {
    const sourceResult = await pool.query('SELECT source_id FROM ogc_sources WHERE id = $1', [req.params.id]);
    if (sourceResult.rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    const sourceId = (sourceResult.rows[0] as { source_id: string }).source_id;
    const result = await pool.query(
      `SELECT id, name FROM map_configs
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(config->'sources') AS s
         WHERE s->>'id' = $1
       )`,
      [sourceId],
    );
    res.json({ configs: result.rows });
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/sources/test-connection — server-side connection test (protected)
app.post('/api/sources/test-connection', requireAuth, async (req, res) => {
  const { url, auth } = req.body as { url?: string; auth?: SourceAuth | null };
  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  try {
    const testUrl = normalizeUrl(url).replace(/\/$/, '');
    const sourceAuth = auth ?? undefined;

    const sourceType = detectTileSourceType(testUrl);
    let testEndpoint: string;
    let acceptHeader = 'application/json';

    if (sourceType === 'xyz') {
      testEndpoint = testUrl.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
      acceptHeader = '*/*';
    } else if (sourceType === 'tilejson') {
      testEndpoint = testUrl;
    } else {
      testEndpoint = `${testUrl}/conformance?f=json`;
    }

    const response = await fetch(appendAuth(testEndpoint, sourceAuth), {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': acceptHeader, ...authHeaders(sourceAuth) },
    });
    if (response.ok) {
      // For TileJSON, also verify structure
      if (sourceType === 'tilejson') {
        const data = await response.json();
        if (!data.tiles || !Array.isArray(data.tiles)) {
          res.json({ status: 'error', error: 'Invalid TileJSON: missing tiles array' });
          return;
        }
      }
      res.json({ status: 'success' });
    } else {
      res.json({ status: 'error', error: `HTTP ${response.status} ${response.statusText}` });
    }
  } catch (err) {
    res.json({ status: 'error', error: err instanceof Error ? err.message : 'Network error' });
  }
});

// POST /api/sources — create a new source (protected)
app.post('/api/sources', requireAuth, async (req, res) => {
  const { source_id, url, label, tile_matrix_set_id, source_type, auth, metadata, proxy } = req.body as SourceRequestBody;

  if (!source_id || !url) {
    res.status(400).json({ error: 'source_id and url are required' });
    return;
  }
  if (!SOURCE_ID_REGEX.test(source_id)) {
    res.status(400).json({ error: 'source_id must be a slug (lowercase letters, numbers, hyphens only)' });
    return;
  }

  try {
    const effectiveType = source_type ?? 'features';
    const { thumbnail } = req.body as { thumbnail?: string };

    // For basemaps, store thumbnail in metadata and skip OGC inspection
    const basemapMetadata = effectiveType === 'basemap' && thumbnail
      ? JSON.stringify({ thumbnail })
      : (effectiveType === 'basemap' ? null : undefined);

    const result = await pool.query(
      `INSERT INTO ogc_sources (source_id, url, label, tile_matrix_set_id, source_type, auth, proxy${basemapMetadata !== undefined ? ', metadata, metadata_updated_at' : ''})
       VALUES ($1, $2, $3, $4, $5, $6, $7${basemapMetadata !== undefined ? ', $8, now()' : ''}) RETURNING *`,
      [
        source_id, url, label ?? null, tile_matrix_set_id ?? 'WebMercatorQuad', effectiveType,
        auth ? JSON.stringify(auth) : null,
        proxy ?? false,
        ...(basemapMetadata !== undefined ? [basemapMetadata] : []),
      ],
    );
    const row = result.rows[0] as { id: string };

    // Skip inspection for basemaps
    if (effectiveType === 'basemap') {
      res.status(201).json(result.rows[0]);
    } else if (metadata) {
      // Client provided metadata (client-side inspection) — save directly
      const updated = await pool.query(
        'UPDATE ogc_sources SET metadata = $1, metadata_updated_at = now() WHERE id = $2 RETURNING *',
        [JSON.stringify(metadata), row.id],
      );
      res.status(201).json(updated.rows[0]);
    } else {
      // No metadata provided — auto-inspect server-side (fallback)
      try {
        const inspected = await inspectSource(url);
        const updated = await pool.query(
          'UPDATE ogc_sources SET metadata = $1, metadata_updated_at = now() WHERE id = $2 RETURNING *',
          [JSON.stringify(inspected), row.id],
        );
        res.status(201).json(updated.rows[0]);
      } catch {
        // Inspection failed — return source without metadata
        res.status(201).json(result.rows[0]);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: `A source with id "${source_id}" already exists` });
      return;
    }
    handleServerError(res, err);
  }
});

// PUT /api/sources/:id — update a source (protected)
app.put('/api/sources/:id', requireAuth, async (req, res) => {
  const { source_id, url, label, tile_matrix_set_id, source_type, auth, metadata, proxy } = req.body as SourceRequestBody;

  if (source_id !== undefined && !SOURCE_ID_REGEX.test(source_id)) {
    res.status(400).json({ error: 'source_id must be a slug (lowercase letters, numbers, hyphens only)' });
    return;
  }

  try {
    const existing = await pool.query('SELECT * FROM ogc_sources WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    const row = existing.rows[0] as {
      source_id: string;
      url: string;
      label: string | null;
      tile_matrix_set_id: string;
      source_type: string;
      auth: SourceAuth | null;
      proxy: boolean;
    };

    const newUrl = url ?? row.url;
    const effectiveType = source_type ?? row.source_type;
    const { thumbnail } = req.body as { thumbnail?: string };

    const result = await pool.query(
      `UPDATE ogc_sources SET source_id = $1, url = $2, label = $3, tile_matrix_set_id = $4, source_type = $5, auth = $6, proxy = $7, updated_at = now()
       WHERE id = $8 RETURNING *`,
      [
        source_id ?? row.source_id,
        newUrl,
        label !== undefined ? (label || null) : row.label,
        tile_matrix_set_id ?? row.tile_matrix_set_id,
        effectiveType,
        auth !== undefined ? (auth ? JSON.stringify(auth) : null) : (row.auth ? JSON.stringify(row.auth) : null),
        proxy !== undefined ? proxy : row.proxy,
        req.params.id,
      ],
    );

    // For basemaps, update thumbnail in metadata and skip OGC inspection
    if (effectiveType === 'basemap') {
      if (thumbnail !== undefined) {
        const meta = thumbnail ? { thumbnail } : null;
        const updated = await pool.query(
          'UPDATE ogc_sources SET metadata = $1, metadata_updated_at = now() WHERE id = $2 RETURNING *',
          [meta ? JSON.stringify(meta) : null, req.params.id],
        );
        res.json(updated.rows[0]);
      } else {
        res.json(result.rows[0]);
      }
      return;
    }

    // Re-inspect if URL changed (non-basemap sources)
    if (url && url !== row.url) {
      if (metadata) {
        // Client provided metadata — save directly
        const updated = await pool.query(
          'UPDATE ogc_sources SET metadata = $1, metadata_updated_at = now() WHERE id = $2 RETURNING *',
          [JSON.stringify(metadata), req.params.id],
        );
        res.json(updated.rows[0]);
        return;
      }
      // No metadata provided — auto-inspect server-side (fallback)
      try {
        const inspected = await inspectSource(newUrl);
        const updated = await pool.query(
          'UPDATE ogc_sources SET metadata = $1, metadata_updated_at = now() WHERE id = $2 RETURNING *',
          [JSON.stringify(inspected), req.params.id],
        );
        res.json(updated.rows[0]);
        return;
      } catch {
        // Inspection failed — return without updated metadata
      }
    }
    res.json(result.rows[0]);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: `A source with that id already exists` });
      return;
    }
    handleServerError(res, err);
  }
});

// PUT /api/sources/:id/metadata — save client-inspected metadata (protected)
app.put('/api/sources/:id/metadata', requireAuth, async (req, res) => {
  const { metadata } = req.body as { metadata?: unknown };
  if (!metadata) {
    res.status(400).json({ error: 'metadata is required' });
    return;
  }
  try {
    const result = await pool.query(
      'UPDATE ogc_sources SET metadata = $1, metadata_updated_at = now() WHERE id = $2 RETURNING *',
      [JSON.stringify(metadata), req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// DELETE /api/sources/:id — delete a source (protected)
app.delete('/api/sources/:id', requireAuth, async (req, res) => {
  try {
    const sourceResult = await pool.query('SELECT source_id FROM ogc_sources WHERE id = $1', [req.params.id]);
    if (sourceResult.rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    const sourceId = (sourceResult.rows[0] as { source_id: string }).source_id;

    // Check usage unless force=true
    if (req.query.force !== 'true') {
      const usage = await pool.query(
        `SELECT id, name FROM map_configs
         WHERE EXISTS (
           SELECT 1 FROM jsonb_array_elements(config->'sources') AS s
           WHERE s->>'id' = $1
         )`,
        [sourceId],
      );
      if (usage.rows.length > 0) {
        const names = (usage.rows as { name: string }[]).map(r => r.name).join(', ');
        res.status(409).json({
          error: `Source is in use by configs: ${names}. Use ?force=true to delete anyway.`,
          configs: usage.rows,
        });
        return;
      }
    }

    await pool.query('DELETE FROM ogc_sources WHERE id = $1', [req.params.id]);
    res.json({ deleted: req.params.id });
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/sources/:id/inspect — refresh metadata for a source (protected)
app.post('/api/sources/:id/inspect', requireAuth, async (req, res) => {
  try {
    const sourceResult = await pool.query('SELECT url FROM ogc_sources WHERE id = $1', [req.params.id]);
    if (sourceResult.rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    const { url } = sourceResult.rows[0] as { url: string };

    const metadata = await inspectSource(url);
    const result = await pool.query(
      'UPDATE ogc_sources SET metadata = $1, metadata_updated_at = now() WHERE id = $2 RETURNING *',
      [JSON.stringify(metadata), req.params.id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// POST /api/sources/import — bulk import sources from existing configs (protected)
app.post('/api/sources/import', requireAuth, async (_req, res) => {
  try {
    const configsResult = await pool.query(
      "SELECT config->'sources' AS sources, config->'imageryLayers' AS imagery_layers, config->'basemaps' AS basemaps FROM map_configs WHERE config IS NOT NULL",
    );

    // Single-pass collection of sources, imagery refs, and basemaps
    const seen = new Map<string, { id: string; url: string; label?: string; tileMatrixSetId?: string; type?: string; auth?: { type: string; name: string; value: string } }>();
    const imagerySourceIds = new Set<string>();
    const seenBasemaps = new Map<string, { id: string; url: string; label: string; thumbnail?: string }>();

    for (const row of configsResult.rows) {
      const r = row as {
        sources: Array<{ id: string; url: string; label?: string; tileMatrixSetId?: string; type?: string; auth?: { type: string; name: string; value: string } }> | null;
        imagery_layers: Array<{ sourceId: string }> | null;
        basemaps: Array<{ id: string; url: string; label: string; thumbnail?: string }> | null;
      };

      if (Array.isArray(r.imagery_layers)) {
        for (const il of r.imagery_layers) {
          if (il.sourceId) imagerySourceIds.add(il.sourceId);
        }
      }

      if (Array.isArray(r.sources)) {
        for (const s of r.sources) {
          if (s.id && s.url && !seen.has(s.id)) {
            seen.set(s.id, s);
          }
        }
      }

      if (Array.isArray(r.basemaps)) {
        for (const b of r.basemaps) {
          if (b.id && b.url && !seenBasemaps.has(b.id)) {
            seenBasemaps.set(b.id, b);
          }
        }
      }
    }

    // Apply cross-reference: if a source is used in imageryLayers, mark it as imagery
    for (const [id, s] of seen) {
      if (!s.type && imagerySourceIds.has(id)) {
        s.type = 'imagery';
      }
    }

    let importedFeatures = 0;
    let importedImagery = 0;
    let importedBasemaps = 0;

    // Import OGC API sources (features + imagery)
    if (seen.size > 0) {
      const values = Array.from(seen.values());
      const placeholders = values.map((_, i) => {
        const b = i * 6;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
      }).join(', ');
      const params = values.flatMap(s => [
        s.id, s.url, s.label ?? null, s.tileMatrixSetId ?? 'WebMercatorQuad',
        s.type ?? 'features', s.auth ? JSON.stringify(s.auth) : null,
      ]);
      const result = await pool.query(
        `INSERT INTO ogc_sources (source_id, url, label, tile_matrix_set_id, source_type, auth)
         VALUES ${placeholders}
         ON CONFLICT (source_id) DO UPDATE SET
           source_type = EXCLUDED.source_type,
           auth = COALESCE(EXCLUDED.auth, ogc_sources.auth)
         RETURNING source_type`,
        params,
      );
      for (const row of result.rows) {
        if ((row as { source_type: string }).source_type === 'imagery') importedImagery++;
        else importedFeatures++;
      }
    }

    // Import basemap sources
    if (seenBasemaps.size > 0) {
      const basemapValues = Array.from(seenBasemaps.values());
      const placeholders = basemapValues.map((_, i) => {
        const b = i * 5;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
      }).join(', ');
      const params = basemapValues.flatMap(b => [
        b.id, b.url, b.label, 'basemap',
        b.thumbnail ? JSON.stringify({ thumbnail: b.thumbnail }) : null,
      ]);
      const result = await pool.query(
        `INSERT INTO ogc_sources (source_id, url, label, source_type, metadata)
         VALUES ${placeholders}
         ON CONFLICT (source_id) DO UPDATE SET
           source_type = EXCLUDED.source_type,
           metadata = COALESCE(EXCLUDED.metadata, ogc_sources.metadata)`,
        params,
      );
      importedBasemaps = result.rowCount ?? 0;
    }

    res.json({
      imported: { features: importedFeatures, imagery: importedImagery, basemaps: importedBasemaps },
      total: seen.size + seenBasemaps.size,
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

// --- Site settings endpoints ---

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

// GET /api/settings — public (needed before login for favicon/title)
app.get('/api/settings', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM site_settings WHERE id = 1');
    if (result.rows.length === 0) {
      res.json({
        header_title: 'Map Config Admin',
        header_color: '#1e293b',
        browser_title: 'Map Config Admin',
        favicon_data_url: null,
        logo_data_url: null,
        logo_height: 32,
      });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// PUT /api/settings — update site settings (protected)
app.put('/api/settings', requireAuth, async (req, res) => {
  const { header_title, header_color, browser_title, favicon_data_url, logo_data_url, logo_height } = req.body as {
    header_title?: string;
    header_color?: string;
    browser_title?: string;
    favicon_data_url?: string | null;
    logo_data_url?: string | null;
    logo_height?: number;
  };

  // Validate
  if (header_title !== undefined && !header_title.trim()) {
    res.status(400).json({ error: 'header_title must not be empty' });
    return;
  }
  if (browser_title !== undefined && !browser_title.trim()) {
    res.status(400).json({ error: 'browser_title must not be empty' });
    return;
  }
  if (header_color !== undefined && !HEX_COLOR_REGEX.test(header_color)) {
    res.status(400).json({ error: 'header_color must be a hex color (e.g. #1e293b)' });
    return;
  }
  if (favicon_data_url !== undefined && favicon_data_url !== null && !favicon_data_url.startsWith('data:image/')) {
    res.status(400).json({ error: 'favicon_data_url must be a data:image/ URL or null' });
    return;
  }
  if (logo_data_url !== undefined && logo_data_url !== null && !logo_data_url.startsWith('data:image/')) {
    res.status(400).json({ error: 'logo_data_url must be a data:image/ URL or null' });
    return;
  }
  if (logo_height !== undefined && (!Number.isInteger(logo_height) || logo_height < 16 || logo_height > 200)) {
    res.status(400).json({ error: 'logo_height must be an integer between 16 and 200' });
    return;
  }

  try {
    // Build dynamic SET clause for partial updates
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (header_title !== undefined) { fields.push(`header_title = $${idx++}`); values.push(header_title.trim()); }
    if (header_color !== undefined) { fields.push(`header_color = $${idx++}`); values.push(header_color); }
    if (browser_title !== undefined) { fields.push(`browser_title = $${idx++}`); values.push(browser_title.trim()); }
    if (favicon_data_url !== undefined) { fields.push(`favicon_data_url = $${idx++}`); values.push(favicon_data_url); }
    if (logo_data_url !== undefined) { fields.push(`logo_data_url = $${idx++}`); values.push(logo_data_url); }
    if (logo_height !== undefined) { fields.push(`logo_height = $${idx++}`); values.push(logo_height); }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    fields.push('updated_at = now()');
    const result = await pool.query(
      `UPDATE site_settings SET ${fields.join(', ')} WHERE id = 1 RETURNING *`,
      values,
    );
    res.json(result.rows[0]);
  } catch (err) {
    handleServerError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Source Proxy — forwards requests to upstream sources with auth applied
// ---------------------------------------------------------------------------

// In-memory cache for source lookups (avoids DB query per tile request)
interface ProxySourceData {
  url: string;
  origin: string;
  urlParams: [string, string][];
  auth: SourceAuth | null;
  proxy: boolean;
}
const proxySourceCache = new Map<string, { data: ProxySourceData; expiresAt: number }>();
const PROXY_CACHE_TTL = 60_000; // 1 minute
const PROXY_CACHE_MAX = 500;

async function resolveProxySource(sourceId: string): Promise<ProxySourceData | null> {
  const cached = proxySourceCache.get(sourceId);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.data;
    proxySourceCache.delete(sourceId);
  }
  // Evict expired entries when cache is full; if none expired, drop the oldest
  if (proxySourceCache.size >= PROXY_CACHE_MAX) {
    const now = Date.now();
    let evicted = false;
    for (const [key, entry] of proxySourceCache) {
      if (entry.expiresAt <= now) { proxySourceCache.delete(key); evicted = true; }
    }
    if (!evicted) {
      // Map iterates in insertion order — first key is oldest
      const oldest = proxySourceCache.keys().next().value;
      if (oldest !== undefined) proxySourceCache.delete(oldest);
    }
  }

  const result = await pool.query(
    'SELECT url, auth, proxy FROM ogc_sources WHERE source_id = $1',
    [sourceId],
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0] as { url: string; auth: SourceAuth | null; proxy: boolean };
  // Pre-parse origin and URL query params so we don't repeat this per request
  const qIdx = row.url.indexOf('?');
  const urlParams = qIdx !== -1 ? [...new URLSearchParams(row.url.substring(qIdx + 1))] : [];
  const data: ProxySourceData = { url: row.url, origin: extractOrigin(row.url), urlParams, auth: row.auth, proxy: row.proxy };
  proxySourceCache.set(sourceId, { data, expiresAt: Date.now() + PROXY_CACHE_TTL });
  return data;
}

app.all('/api/proxy/:sourceId/*', async (req, res) => {
  try {
    const { sourceId } = req.params;
    const remainingPath = (req.params as Record<string, string>)[0] ?? '';

    const source = await resolveProxySource(sourceId);
    if (!source) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    if (!source.proxy) {
      res.status(403).json({ error: 'Proxying is not enabled for this source' });
      return;
    }

    const targetParams = new URLSearchParams();

    // Forward client query params
    for (const [key, val] of Object.entries(req.query)) {
      if (typeof val === 'string') targetParams.set(key, val);
    }

    // Forward query params embedded in the source URL (e.g., API keys in the URL)
    for (const [name, value] of source.urlParams) {
      targetParams.set(name, value);
    }

    // Apply query-param auth (takes priority over URL-embedded params)
    if (source.auth?.type === 'query_param') {
      targetParams.set(source.auth.name, source.auth.value);
    }

    const qs = targetParams.toString();
    const targetUrl = `${source.origin}/${remainingPath}${qs ? '?' + qs : ''}`;

    // Build upstream request headers
    const upstreamHeaders: Record<string, string> = {};
    if (source.auth?.type === 'header') {
      upstreamHeaders[source.auth.name] = source.auth.value;
    }
    if (req.headers.accept) upstreamHeaders['Accept'] = req.headers.accept;

    // Prepare upstream request options
    const fetchOpts: RequestInit & { duplex?: string } = {
      method: req.method,
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(30_000),
    };

    // Forward body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (req.headers['content-type']) {
        upstreamHeaders['Content-Type'] = req.headers['content-type'];
      }
      if (req.body && typeof req.body === 'object') {
        fetchOpts.body = JSON.stringify(req.body);
      }
    }

    const upstream = await fetch(targetUrl, fetchOpts);

    // Forward response status and content headers (not CORS — handled by app-level middleware)
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-encoding', 'cache-control', 'etag', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    if (upstream.body) {
      // @ts-expect-error Node 18+ ReadableStream is compatible with Readable.fromWeb
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', (err: Error) => {
        console.error('Proxy stream error:', err);
        if (!res.headersSent) res.status(502).json({ error: 'Upstream stream failed' });
        else res.destroy();
      });
      res.on('close', () => { stream.destroy(); });
      stream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      res.status(504).json({ error: 'Upstream request timed out' });
    } else {
      console.error('Proxy error:', err);
      res.status(502).json({ error: 'Failed to reach upstream source' });
    }
  }
});

// Serve SPA static files (after all API routes)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');
const indexHtml = path.join(distPath, 'index.html');
const spaBase = (process.env.SPA_BASE_PATH ?? '/').replace(/\/+$/, '') || '/';
app.use(spaBase, express.static(distPath));

// JSON 404 for unmatched API routes (must be before SPA catch-all)
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// SPA catch-all under the configured base path
app.get(spaBase === '/' ? '*' : `${spaBase}/*`, (_req, res) => {
  res.sendFile(indexHtml);
});

// Start server
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Admin API server running on http://localhost:${PORT}`);
    });
  })
  .catch((err: unknown) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
