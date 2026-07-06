import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLayerQueryables } from '../useLayerQueryables';
import { useMapStore } from '../../stores/mapStore';
import type { LayerConfig, MapSource } from '@ogc-maps/storybook-components/types';

const fetchQueryables = vi.fn();

vi.mock('@ogc-maps/storybook-components/utils', () => ({
  fetchQueryables: (...args: unknown[]) => fetchQueryables(...args),
  toAvailableProperties: () => [],
  isOgcApiSource: () => true,
}));

describe('useLayerQueryables', () => {
  beforeEach(() => {
    fetchQueryables.mockReset();
    useMapStore.setState({
      sources: [{ id: 'src-1', url: 'http://example.test' } as MapSource],
    });
  });

  it('fetches each layer only once, even while sibling layers are still resolving', async () => {
    let resolveA: (v: unknown) => void = () => {};
    fetchQueryables.mockImplementation((_url: string, collection: string) => {
      if (collection === 'a') {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve({});
    });

    const layers = [
      { id: 'layer-a', sourceId: 'src-1', collection: 'a' },
      { id: 'layer-b', sourceId: 'src-1', collection: 'b' },
    ] as unknown as LayerConfig[];

    renderHook(() => useLayerQueryables(layers));

    // layer-b resolves quickly and triggers a cache update; that update must
    // not re-trigger a fetch for the still-pending layer-a.
    await waitFor(() => expect(fetchQueryables).toHaveBeenCalledTimes(2));

    resolveA({});
    await waitFor(() => expect(fetchQueryables).toHaveBeenCalledTimes(2));
  });
});
