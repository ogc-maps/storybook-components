import { describe, it, expect } from 'vitest';
import { buildBoxPolygon, buildBoxDrawData } from '../boxDraw';

describe('buildBoxPolygon', () => {
  it('returns a closed ring (first coordinate equals last)', () => {
    const poly = buildBoxPolygon([10, 20], [30, 40]);
    const ring = poly.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('builds the four expected corners in order', () => {
    const poly = buildBoxPolygon([10, 20], [30, 40]);
    expect(poly.type).toBe('Polygon');
    expect(poly.coordinates[0]).toEqual([
      [10, 20],
      [30, 20],
      [30, 40],
      [10, 40],
      [10, 20],
    ]);
  });

  it('works when the second corner has smaller lng/lat (reversed corners)', () => {
    const poly = buildBoxPolygon([30, 40], [10, 20]);
    expect(poly.type).toBe('Polygon');
    expect(poly.coordinates[0]).toHaveLength(5);
    const ring = poly.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('handles zero-area degenerate box (both corners equal)', () => {
    const poly = buildBoxPolygon([5, 5], [5, 5]);
    const ring = poly.coordinates[0];
    expect(ring).toHaveLength(5);
    // All five points are identical
    ring.forEach(pt => expect(pt).toEqual([5, 5]));
  });
});

describe('buildBoxDrawData', () => {
  it('returns a GeoJSON Feature wrapping the polygon', () => {
    const feature = buildBoxDrawData([0, 0], [1, 1]);
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Polygon');
    expect(feature.properties).toEqual({});
  });

  it('geometry equals buildBoxPolygon output for the same corners', () => {
    const feature = buildBoxDrawData([10, 20], [30, 40]);
    expect(feature.geometry).toEqual(buildBoxPolygon([10, 20], [30, 40]));
  });
});
