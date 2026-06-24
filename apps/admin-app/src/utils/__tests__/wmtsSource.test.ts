import { describe, it, expect } from 'vitest';
import { savedSourceToWmts, savedSourceIsImagery } from '../wmtsSource';

describe('savedSourceToWmts', () => {
  const base = {
    source_id: 'gibs-modis',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml',
    label: 'GIBS MODIS',
    tile_matrix_set_id: 'GoogleMapsCompatible_Level9',
  };

  it('maps metadata.wmtsTileUrlTemplate onto the WmtsSource tileUrlTemplate', () => {
    const src = savedSourceToWmts({
      ...base,
      metadata: {
        wmtsLayer: 'MODIS',
        wmtsStyle: 'default',
        wmtsFormat: 'image/jpeg',
        wmtsTileMatrixSet: 'GoogleMapsCompatible_Level9',
        wmtsTileSize: 256,
        wmtsTileUrlTemplate:
          'https://gibs/best/MODIS/default/2026-06-23/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg',
      },
    });
    expect(src.tileUrlTemplate).toBe(
      'https://gibs/best/MODIS/default/2026-06-23/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg',
    );
    expect(src.sourceType).toBe('wmts');
    expect(src.layer).toBe('MODIS');
  });

  it('leaves tileUrlTemplate undefined when not stored (pre-fix sources)', () => {
    const src = savedSourceToWmts({ ...base, metadata: { wmtsLayer: 'MODIS' } });
    expect(src.tileUrlTemplate).toBeUndefined();
  });
});

describe('savedSourceIsImagery', () => {
  it('accepts imagery and wmts, rejects features/basemap', () => {
    expect(savedSourceIsImagery({ source_type: 'imagery' })).toBe(true);
    expect(savedSourceIsImagery({ source_type: 'wmts' })).toBe(true);
    expect(savedSourceIsImagery({ source_type: 'features' })).toBe(false);
    expect(savedSourceIsImagery({ source_type: 'basemap' })).toBe(false);
  });
});
