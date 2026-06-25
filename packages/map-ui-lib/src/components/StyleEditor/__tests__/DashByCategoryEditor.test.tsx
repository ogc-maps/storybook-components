import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashByCategoryEditor } from '../DashByCategoryEditor';
import type { DashByCategory } from '../../../types';

describe('DashByCategoryEditor', () => {
  it('renders the "+ Dash by category" button when value is undefined', () => {
    const html = renderToStaticMarkup(
      <DashByCategoryEditor value={undefined} onChange={() => {}} />,
    );
    expect(html).toContain('+ Dash by category');
  });

  it('renders the editor body when value is provided, without throwing', () => {
    const value: DashByCategory = {
      property: 'category',
      cases: [{ value: 'a', dasharray: [4, 2] }],
    };
    const html = renderToStaticMarkup(<DashByCategoryEditor value={value} onChange={() => {}} />);
    expect(html).toContain('Dash by category');
    expect(html).toContain('Property');
  });

  // Regression for React error #310 (hook-order): all hooks (incl. the
  // auto-fetch useEffect) must run unconditionally above the `!value` early
  // return, so a value flip from undefined -> object doesn't change hook count.
  // renderToStaticMarkup runs a single pass and doesn't fire effects, so it
  // can't fully simulate the re-render that triggered #310; this asserts both
  // states at least render without throwing. The structural guarantee (effect
  // declared before the early return) is enforced by source review + build.
  it('renders both no-value and value states without throwing', () => {
    expect(() =>
      renderToStaticMarkup(<DashByCategoryEditor value={undefined} onChange={() => {}} />),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <DashByCategoryEditor
          value={{ property: 'p', cases: [] }}
          onChange={() => {}}
          onFetchDistinctValues={async () => ['x', 'y']}
        />,
      ),
    ).not.toThrow();
  });
});
