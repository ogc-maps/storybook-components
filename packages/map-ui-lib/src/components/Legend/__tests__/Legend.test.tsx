import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Legend, getLayerOpacity } from '../Legend';
import type { LayerConfig } from '../../../types';

function makeLayer(id: string, shape: 'square' | 'circle' | 'line' | 'outline-square' | 'outline-circle', extra: Record<string, unknown> = {}): LayerConfig {
  return {
    id,
    sourceId: 'demo',
    collection: 'demo',
    label: id,
    visible: true,
    dataMode: 'vector-tiles',
    legend: {
      entries: [
        {
          label: id,
          color: '#1d4ed8',
          shape,
          ...extra,
        },
      ],
    },
  } as LayerConfig;
}

describe('Legend Swatch', () => {
  it('renders outline-square as SVG <rect> with no fill', () => {
    const html = renderToStaticMarkup(
      <Legend
        layers={[makeLayer('a', 'outline-square', { outlineColor: '#1d4ed8', outlineWidth: 2 })]}
        visibleLayerIds={['a']}
      />,
    );
    expect(html).toContain('<rect');
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke="#1d4ed8"');
    expect(html).toContain('stroke-width="2"');
  });

  it('renders outline-circle as SVG <circle> with no fill', () => {
    const html = renderToStaticMarkup(
      <Legend
        layers={[makeLayer('b', 'outline-circle', { outlineColor: '#dc2626', outlineWidth: 1.5 })]}
        visibleLayerIds={['b']}
      />,
    );
    expect(html).toMatch(/<circle\b/);
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke="#dc2626"');
  });

  it('honors dasharray on outline-square (dashed border)', () => {
    const html = renderToStaticMarkup(
      <Legend
        layers={[makeLayer('c', 'outline-square', { dasharray: [3, 2] })]}
        visibleLayerIds={['c']}
      />,
    );
    expect(html).toContain('<rect');
    expect(html).toContain('stroke-dasharray="3,2"');
  });

  it('honors dasharray on outline-circle (dashed border)', () => {
    const html = renderToStaticMarkup(
      <Legend
        layers={[makeLayer('d', 'outline-circle', { dasharray: [2, 2] })]}
        visibleLayerIds={['d']}
      />,
    );
    expect(html).toMatch(/<circle\b/);
    expect(html).toContain('stroke-dasharray="2,2"');
  });

  it('omits stroke-dasharray when no dasharray (or only one element) is provided', () => {
    const html = renderToStaticMarkup(
      <Legend
        layers={[makeLayer('e', 'outline-square')]}
        visibleLayerIds={['e']}
      />,
    );
    expect(html).not.toContain('stroke-dasharray');
  });

  it('does not apply rounded-sm corner radius to outline-square (sharp corners)', () => {
    // Outline shapes render as SVG <rect> without any rx/ry — sharp 90° corners
    // are how outline-square stays visually distinct from outline-circle.
    const html = renderToStaticMarkup(
      <Legend
        layers={[makeLayer('f', 'outline-square')]}
        visibleLayerIds={['f']}
      />,
    );
    // The <rect> element itself should carry no rx attribute.
    const rectMatch = html.match(/<rect[^>]*\/?>/);
    expect(rectMatch).not.toBeNull();
    expect(rectMatch![0]).not.toContain('rx=');
    expect(rectMatch![0]).not.toContain('rounded-sm');
  });

  it('renders the plain `line` shape with dasharray as SVG <line>', () => {
    // Pre-existing behavior — this test guards against regressing the line shape
    // while reworking outline shapes.
    const html = renderToStaticMarkup(
      <Legend
        layers={[makeLayer('g', 'line', { dasharray: [4, 2] })]}
        visibleLayerIds={['g']}
      />,
    );
    expect(html).toMatch(/<line\b/);
    expect(html).toContain('stroke-dasharray="4,2"');
  });
});

describe('Legend getLayerOpacity (slider read side)', () => {
  // The single legend slider value is the layer's runtime `_opacityFactor` (the
  // 0–1 multiplier position), kept consistent with the write side in the store.
  // It is NOT a per-style absolute opacity read off styles[0] — that was the #6
  // read/write asymmetry bug.
  const baseLayer = (runtime: Record<string, unknown> = {}): LayerConfig =>
    ({
      id: 'a',
      sourceId: 'demo',
      collection: 'demo',
      label: 'a',
      visible: true,
      dataMode: 'vector-tiles',
      legend: { entries: [{ label: 'a', color: '#1d4ed8' }] },
      // Outline-only polygon: fill base 0 (click-selection) + line base 1.
      styles: [
        { type: 'fill', paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
        { type: 'line', paint: { 'line-color': '#f00', 'line-opacity': 1 } },
      ],
      ...runtime,
    }) as LayerConfig;

  it('returns the runtime _opacityFactor when present', () => {
    expect(getLayerOpacity(baseLayer({ _opacityFactor: 0.4 }))).toBe(0.4);
    expect(getLayerOpacity(baseLayer({ _opacityFactor: 0 }))).toBe(0);
  });

  it('falls back to neutral 1 when _opacityFactor is absent (not styles[0] fill base 0)', () => {
    // The old read returned styles[0]'s fill-opacity (0 here) and white-screened
    // the slider at 0% for an outline-only layer. The multiplier-neutral 1 is right.
    expect(getLayerOpacity(baseLayer())).toBe(1);
  });
});
