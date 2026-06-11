import { describe, it, expect } from 'vitest';
import { DEFAULT_EXPORT_FORMATS } from '../exportFormats';

describe('DEFAULT_EXPORT_FORMATS', () => {
  it('contains six formats', () => {
    expect(DEFAULT_EXPORT_FORMATS).toHaveLength(6);
  });

  it('every format has required fields', () => {
    for (const fmt of DEFAULT_EXPORT_FORMATS) {
      expect(fmt.id, `${fmt.id} missing id`).toBeTruthy();
      expect(fmt.label, `${fmt.id} missing label`).toBeTruthy();
      expect(fmt.extension, `${fmt.id} missing extension`).toBeTruthy();
      expect(fmt.description, `${fmt.id} missing description`).toBeTruthy();
    }
  });

  it('all extensions start with a dot', () => {
    for (const fmt of DEFAULT_EXPORT_FORMATS) {
      expect(fmt.extension.startsWith('.'), `${fmt.id} extension should start with '.'`).toBe(true);
    }
  });

  it('all ids are unique', () => {
    const ids = DEFAULT_EXPORT_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes expected format ids', () => {
    const ids = DEFAULT_EXPORT_FORMATS.map((f) => f.id);
    expect(ids).toContain('csv');
    expect(ids).toContain('geojson');
    expect(ids).toContain('kml');
    expect(ids).toContain('shapefile');
    expect(ids).toContain('flatgeobuf');
    expect(ids).toContain('geopackage');
  });

  it('shapefile uses .zip extension (multi-file format)', () => {
    const shapefile = DEFAULT_EXPORT_FORMATS.find((f) => f.id === 'shapefile');
    expect(shapefile?.extension).toBe('.zip');
  });
});
