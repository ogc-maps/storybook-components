/**
 * Hardened zip extraction for shapefile bundles. Guards against:
 *  - zip-slip: entries whose resolved path escapes the destination dir.
 *  - zip-bomb: caps on total uncompressed bytes, entry count, and per-entry ratio.
 *  - junk: only shapefile sidecar files are extracted; everything else is ignored.
 */
import yauzl from 'yauzl';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const SHP_SIDECAR_EXT = new Set(['.shp', '.shx', '.dbf', '.prj', '.cpg', '.qpj']);

export interface UnzipLimits {
  maxTotalBytes: number;
  maxEntries: number;
  maxRatio: number;
}

export const DEFAULT_UNZIP_LIMITS: UnzipLimits = {
  maxTotalBytes: 500 * 1024 * 1024, // 500 MB uncompressed
  maxEntries: 64,
  maxRatio: 200, // uncompressed / compressed
};

export interface ExtractResult {
  /** Absolute path to the single extracted `.shp`. */
  shpPath: string;
  /** Whether a `.prj` (CRS sidecar) was present. */
  hasPrj: boolean;
}

/**
 * zip-slip guard: true only when `entryName` resolves to a path inside
 * `destDir`. Rejects `..` traversal and absolute paths. Pure so it can be
 * unit-tested without constructing real archives.
 */
export function isSafeZipEntry(destDir: string, entryName: string): boolean {
  if (path.isAbsolute(entryName)) return false;
  const target = path.resolve(destDir, entryName);
  const rel = path.relative(destDir, target);
  return rel === '' ? false : !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Shapefile sidecar extensions we will extract (everything else is ignored). */
export function isShapefileSidecar(name: string): boolean {
  return SHP_SIDECAR_EXT.has(path.extname(name).toLowerCase());
}

/**
 * Extract a shapefile bundle into `destDir` and return the `.shp` path.
 * Throws if zero or multiple `.shp` files are present, or if a guard trips.
 */
export function extractShapefileZip(
  zipPath: string,
  destDir: string,
  limits: UnzipLimits = DEFAULT_UNZIP_LIMITS,
): Promise<ExtractResult> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('Could not open zip'));
        return;
      }

      let totalBytes = 0;
      let entryCount = 0;
      const shpFiles: string[] = [];
      const prjStems: string[] = [];
      let settled = false;

      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        zipfile.close();
        reject(e);
      };

      zipfile.on('error', fail);

      zipfile.on('end', () => {
        if (settled) return;
        settled = true;
        if (shpFiles.length === 0) {
          reject(new Error('Zip contains no .shp file'));
        } else if (shpFiles.length > 1) {
          reject(new Error(`Zip contains multiple shapefiles (${shpFiles.length}); upload one at a time`));
        } else {
          // GDAL only picks up a .prj that shares the .shp's basename in the
          // same directory (all sidecars are flattened into destDir above).
          // A .prj present elsewhere in the zip under an unrelated name would
          // never actually be found by GDAL, so only count it if it matches.
          const shpStem = path.basename(shpFiles[0], path.extname(shpFiles[0])).toLowerCase();
          const hasPrj = prjStems.includes(shpStem);
          resolve({ shpPath: shpFiles[0], hasPrj });
        }
      });

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (settled) return;
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          fail(new Error('Zip has too many entries'));
          return;
        }

        const name = entry.fileName;
        // Skip directories.
        if (name.endsWith('/')) {
          zipfile.readEntry();
          return;
        }

        // zip-slip: the resolved target must stay within destDir.
        if (!isSafeZipEntry(destDir, name)) {
          fail(new Error(`Unsafe path in zip: ${name}`));
          return;
        }

        // Only extract shapefile sidecars; flatten into destDir by basename.
        const ext = path.extname(name).toLowerCase();
        if (!isShapefileSidecar(name)) {
          zipfile.readEntry();
          return;
        }

        // zip-bomb: per-entry ratio + running total.
        const uncompressed = entry.uncompressedSize ?? 0;
        const compressed = entry.compressedSize ?? 0;
        if (compressed > 0 && uncompressed / compressed > limits.maxRatio) {
          fail(new Error('Zip entry compression ratio too high'));
          return;
        }
        totalBytes += uncompressed;
        if (totalBytes > limits.maxTotalBytes) {
          fail(new Error('Zip uncompressed size exceeds limit'));
          return;
        }

        const outPath = path.join(destDir, path.basename(name));
        if (ext === '.shp') shpFiles.push(outPath);
        if (ext === '.prj') prjStems.push(path.basename(name, path.extname(name)).toLowerCase());

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            fail(streamErr ?? new Error('Could not read zip entry'));
            return;
          }
          pipeline(readStream, fs.createWriteStream(outPath))
            .then(() => zipfile.readEntry())
            .catch(fail);
        });
      });

      zipfile.readEntry();
    });
  });
}
