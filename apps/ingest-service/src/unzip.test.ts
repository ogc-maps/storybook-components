import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSafeZipEntry, isShapefileSidecar, extractShapefileZip } from './unzip.js';

const dest = '/tmp/ingest-abc';

describe('isSafeZipEntry (zip-slip guard)', () => {
  it('accepts normal entries inside the dir', () => {
    expect(isSafeZipEntry(dest, 'parcels.shp')).toBe(true);
    expect(isSafeZipEntry(dest, 'sub/parcels.shp')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(isSafeZipEntry(dest, '../evil.shp')).toBe(false);
    expect(isSafeZipEntry(dest, '../../etc/passwd')).toBe(false);
    expect(isSafeZipEntry(dest, 'sub/../../evil')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isSafeZipEntry(dest, '/etc/passwd')).toBe(false);
  });

  it('rejects the dir itself', () => {
    expect(isSafeZipEntry(dest, '')).toBe(false);
  });
});

describe('isShapefileSidecar', () => {
  it('accepts shapefile sidecar extensions', () => {
    for (const ext of ['.shp', '.shx', '.dbf', '.prj', '.cpg']) {
      expect(isShapefileSidecar(`parcels${ext}`)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    expect(isShapefileSidecar('readme.txt')).toBe(false);
    expect(isShapefileSidecar('evil.exe')).toBe(false);
    expect(isShapefileSidecar('nested.zip')).toBe(false);
  });
});

describe('extractShapefileZip (.prj basename matching)', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function buildZip(files: Record<string, string>): { zipPath: string; destDir: string } {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unzip-test-'));
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unzip-dest-'));
    tmpDirs.push(workDir, destDir);
    const paths = Object.entries(files).map(([name, content]) => {
      const p = path.join(workDir, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
      return p;
    });
    const zipPath = path.join(workDir, 'bundle.zip');
    execFileSync('zip', ['-j', zipPath, ...paths], { stdio: 'pipe' });
    return { zipPath, destDir };
  }

  it('reports hasPrj=true when the .prj basename matches the .shp', async () => {
    const { zipPath, destDir } = buildZip({
      'parcels.shp': 'shp',
      'parcels.shx': 'shx',
      'parcels.dbf': 'dbf',
      'parcels.prj': 'GEOGCS[...]',
    });
    const result = await extractShapefileZip(zipPath, destDir);
    expect(result.hasPrj).toBe(true);
  });

  it('reports hasPrj=false when a .prj is present but its basename does not match the .shp', async () => {
    // Simulates a leftover/unrelated .prj bundled alongside the shapefile —
    // GDAL only associates a .prj with a .shp of the same basename, so a
    // mismatched one should not be treated as a declared CRS.
    const { zipPath, destDir } = buildZip({
      'parcels.shp': 'shp',
      'parcels.shx': 'shx',
      'parcels.dbf': 'dbf',
      'old_export/backup.prj': 'GEOGCS[...]',
    });
    const result = await extractShapefileZip(zipPath, destDir);
    expect(result.hasPrj).toBe(false);
  });

  it('matches basenames case-insensitively', async () => {
    const { zipPath, destDir } = buildZip({
      'Parcels.shp': 'shp',
      'Parcels.shx': 'shx',
      'Parcels.dbf': 'dbf',
      'PARCELS.PRJ': 'GEOGCS[...]',
    });
    const result = await extractShapefileZip(zipPath, destDir);
    expect(result.hasPrj).toBe(true);
  });
});
