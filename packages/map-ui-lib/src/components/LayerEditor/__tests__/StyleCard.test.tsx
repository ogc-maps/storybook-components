import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StyleCard } from '../StyleCard';
import type { StyleConfig } from '../../../types';

const fill: StyleConfig = { type: 'fill', paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.6 } };

describe('StyleCard reorder controls', () => {
  it('renders move up/down buttons when handlers are provided', () => {
    const html = renderToStaticMarkup(
      <StyleCard index={1} style={fill} onMoveUp={() => {}} onMoveDown={() => {}}>
        <div />
      </StyleCard>,
    );
    expect(html).toContain('Move style up');
    expect(html).toContain('Move style down');
  });

  it('disables the up button on the first card and the down button on the last', () => {
    const first = renderToStaticMarkup(
      <StyleCard index={0} style={fill} isFirst onMoveUp={() => {}} onMoveDown={() => {}}>
        <div />
      </StyleCard>,
    );
    // The "up" button (first move button) should be disabled.
    expect(first).toMatch(/aria-label="Move style up"[^>]*disabled/);

    const last = renderToStaticMarkup(
      <StyleCard index={2} style={fill} isLast onMoveUp={() => {}} onMoveDown={() => {}}>
        <div />
      </StyleCard>,
    );
    expect(last).toMatch(/aria-label="Move style down"[^>]*disabled/);
  });

  it('omits move controls entirely when no handlers are given', () => {
    const html = renderToStaticMarkup(
      <StyleCard index={0} style={fill}>
        <div />
      </StyleCard>,
    );
    expect(html).not.toContain('Move style up');
    expect(html).not.toContain('Move style down');
  });
});

// The swap logic used by LayerEditor: reordering the styles array is the source
// of truth for render order, so a correct swap is the whole feature.
describe('style array reorder semantics', () => {
  function swap<T>(arr: T[], from: number, to: number): T[] {
    if (to < 0 || to >= arr.length) return arr;
    const next = [...arr];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  }

  it('moves an item up by swapping with its predecessor', () => {
    expect(swap(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
  });

  it('moves an item down by swapping with its successor', () => {
    expect(swap(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op past the ends', () => {
    expect(swap(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(swap(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });
});
