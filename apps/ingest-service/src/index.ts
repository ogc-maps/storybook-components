/**
 * Ingest sidecar HTTP API. Internal-only service (not exposed through the
 * gateway) that the admin-app forwards uploads to. Runs ogr2ogr against PostGIS.
 */
import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'child_process';
import { createPool } from './db.js';
import { resolveFormat, FORMATS } from './formats.js';
import { isValidIdentifier } from './identifiers.js';
import { isValidSrs, isValidGeomField } from './ogr.js';
import { Semaphore, SemaphoreBusyError } from './semaphore.js';
import {
  ingestFile,
  inspectSource,
  sweepStaleTempDirs,
  BadRequestError,
  NeedsLayerError,
  OgrError,
} from './ingest.js';
import type { FormatId, IngestRequestFields } from './types.js';
import { FORMAT_IDS } from './types.js';

const PORT = Number(process.env.PORT ?? 8081);
const MAX_BYTES = Number(process.env.INGEST_MAX_MB ?? 100) * 1024 * 1024;
const MAX_CONCURRENCY = Number(process.env.INGEST_MAX_CONCURRENCY ?? 2);

const pool = createPool();
const semaphore = new Semaphore(MAX_CONCURRENCY);
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: MAX_BYTES, files: 1 } });

export const app = express();

app.get('/healthz', (_req, res) => {
  execFile('ogr2ogr', ['--version'], (err, stdout) => {
    if (err) {
      res.status(503).json({ status: 'error', error: 'ogr2ogr unavailable' });
      return;
    }
    res.json({ status: 'ok', ogr2ogr: String(stdout).trim() });
  });
});

/** Read the first bytes of a file for magic-byte sniffing. */
async function readHead(filePath: string, n = 512): Promise<Uint8Array> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Multer saves uploads under a random, EXTENSIONLESS name. GDAL detects some
 * drivers purely from the extension — CSV has no magic bytes, so `ogrinfo` /
 * `ogr2ogr` reject an extensionless CSV with "not recognized as being in a
 * supported file format". Rename the temp file to carry the canonical extension
 * for its resolved format and return the new path (caller must clean it up).
 */
async function ensureExtension(filePath: string, format: FormatId): Promise<string> {
  const ext = FORMATS[format].extensions[0];
  if (filePath.toLowerCase().endsWith(ext)) return filePath;
  const withExt = `${filePath}${ext}`;
  await fs.rename(filePath, withExt);
  return withExt;
}

function field(req: express.Request, name: keyof IngestRequestFields): string | undefined {
  const v = (req.body as Record<string, unknown>)?.[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// POST /layers — multi-layer preflight: list layers in an uploaded file.
app.post('/layers', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'file is required' });
    return;
  }
  let srcPath = req.file.path;
  try {
    const requested = (field(req, 'format') ?? 'auto') as FormatId | 'auto';
    const head = await readHead(srcPath);
    const format = resolveFormat(requested, req.file.originalname, head); // validate type
    srcPath = await ensureExtension(srcPath, format);
    const { layers } = await inspectSource(srcPath, { format, geomField: field(req, 'geomField') });
    res.json({ layers });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  } finally {
    await fs.rm(srcPath, { force: true }).catch(() => undefined);
  }
});

// POST /ingest — load an uploaded file into the uploads schema.
app.post('/ingest', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'file is required' });
    return;
  }
  let filePath = req.file.path;
  try {
    const table = field(req, 'table');
    if (!table || !isValidIdentifier(table)) {
      res.status(400).json({ error: 'invalid or missing table name' });
      return;
    }
    const schema = field(req, 'schema') ?? 'uploads';
    if (schema !== 'uploads') {
      res.status(400).json({ error: 'schema must be "uploads"' });
      return;
    }
    const requested = (field(req, 'format') ?? 'auto') as FormatId | 'auto';
    if (requested !== 'auto' && !FORMAT_IDS.includes(requested)) {
      res.status(400).json({ error: `unsupported format: ${requested}` });
      return;
    }

    const srs = field(req, 'srs');
    if (srs && !isValidSrs(srs)) {
      res.status(400).json({ error: 'invalid srs (expected an authority code like EPSG:2232)' });
      return;
    }
    const geomField = field(req, 'geomField');
    if (geomField && !isValidGeomField(geomField)) {
      res.status(400).json({ error: 'invalid geomField (expected a column name)' });
      return;
    }

    const head = await readHead(filePath);
    const format = resolveFormat(requested, req.file.originalname, head);
    filePath = await ensureExtension(filePath, format);

    const result = await semaphore.run(() =>
      ingestFile({
        pool,
        filePath,
        format,
        table,
        srs,
        geomField,
        layer: field(req, 'layer'),
      }),
    );
    res.json(result);
  } catch (err) {
    if (err instanceof NeedsLayerError) {
      res.status(400).json({ error: err.message, needsLayer: true, layers: err.layers });
    } else if (err instanceof SemaphoreBusyError) {
      res.status(429).json({ error: err.message });
    } else if (err instanceof BadRequestError) {
      res.status(400).json({ error: err.message });
    } else if (err instanceof OgrError) {
      res.status(500).json({ error: err.message, stderr: err.stderr });
    } else {
      res.status(500).json({ error: (err as Error).message });
    }
  } finally {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
  }
});

// Multer errors (e.g. file too large) → clean JSON.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: err.message });
    return;
  }
  next(err);
});

const isMainModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  void sweepStaleTempDirs();
  setInterval(() => void sweepStaleTempDirs(), 60 * 60 * 1000).unref();
  app.listen(PORT, () => {
    console.log(`Ingest service listening on http://localhost:${PORT}`);
  });
}
