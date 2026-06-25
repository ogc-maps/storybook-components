import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useMapStore,
  useActiveLayerIds,
  useEffectiveCql2Filters,
} from '../mapStore';

// Capture the initial state once so we can reset between tests. (Zustand 5
// has no built-in `getInitialState` on this store — replicate via snapshot.)
const initialState = useMapStore.getState();

beforeEach(() => {
  // Reset to a clean copy of the initial store state (`true` replaces, doesn't merge).
  useMapStore.setState({ ...initialState }, true);
});

const makeLayer = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'l1',
    type: 'vector-tile',
    source: 'src1',
    sourceLayer: 'sl',
    visible: true,
    opacity: 1,
    styles: [
      {
        type: 'fill',
        paint: { 'fill-color': '#000', 'fill-opacity': 1 },
      },
    ],
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe('mapStore — viewState', () => {
  it('setViewState merges partial viewport', () => {
    useMapStore.getState().setViewState({ longitude: 5, latitude: 6, zoom: 7 });
    const v = useMapStore.getState().viewState;
    expect(v.longitude).toBe(5);
    expect(v.latitude).toBe(6);
    expect(v.zoom).toBe(7);
    // pitch/bearing untouched
    expect(v.pitch).toBe(0);
    expect(v.bearing).toBe(0);
  });
});

describe('mapStore — layers', () => {
  beforeEach(() => {
    useMapStore.setState({
      layers: [makeLayer({ id: 'l1', visible: true }), makeLayer({ id: 'l2', visible: false })],
    });
  });

  it('toggleLayerVisibility flips visible', () => {
    useMapStore.getState().toggleLayerVisibility('l1');
    expect(useMapStore.getState().layers.find((l) => l.id === 'l1')!.visible).toBe(false);
    useMapStore.getState().toggleLayerVisibility('l1');
    expect(useMapStore.getState().layers.find((l) => l.id === 'l1')!.visible).toBe(true);
  });

  it('setLayerVisibility sets explicit value', () => {
    useMapStore.getState().setLayerVisibility('l2', true);
    expect(useMapStore.getState().layers.find((l) => l.id === 'l2')!.visible).toBe(true);
  });

  it('reorderLayers permutes layer order', () => {
    useMapStore.getState().reorderLayers(['l2', 'l1']);
    expect(useMapStore.getState().layers.map((l) => l.id)).toEqual(['l2', 'l1']);
  });

  it('reorderLayers drops unknown ids', () => {
    useMapStore.getState().reorderLayers(['l2', 'unknown', 'l1']);
    expect(useMapStore.getState().layers.map((l) => l.id)).toEqual(['l2', 'l1']);
  });

  it('setLayerOpacity scales paint opacity by the slider factor (base 1)', () => {
    useMapStore.getState().setLayerOpacity('l1', 0.25);
    const layer = useMapStore.getState().layers.find((l) => l.id === 'l1')!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((layer.styles![0] as any).paint['fill-opacity']).toBe(0.25);
    // The slider position is recorded on the layer so the Legend can display it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((layer as any)._opacityFactor).toBe(0.25);
  });

  it('setLayerOpacity multiplies the original base, not the just-applied value', () => {
    // Two consecutive drags must both be relative to the configured base (1),
    // not compound off the previous result.
    useMapStore.getState().setLayerOpacity('l1', 0.5);
    useMapStore.getState().setLayerOpacity('l1', 0.5);
    const styles = useMapStore.getState().layers.find((l) => l.id === 'l1')!.styles!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((styles[0] as any).paint['fill-opacity']).toBe(0.5);
  });

  it('outline-only polygon keeps a visible outline across slider positions (#6)', () => {
    // fill base 0 (transparent click-selection fill) + line base 1 (the outline).
    useMapStore.setState({
      layers: [
        makeLayer({
          id: 'outline',
          visible: true,
          styles: [
            { type: 'fill', paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
            { type: 'line', paint: { 'line-color': '#f00', 'line-opacity': 1 } },
          ],
        }),
      ],
    });

    const stylesAt = (factor: number) => {
      useMapStore.getState().setLayerOpacity('outline', factor);
      return useMapStore.getState().layers.find((l) => l.id === 'outline')!.styles!;
    };

    for (const factor of [0, 0.5, 1]) {
      const styles = stylesAt(factor);
      // Fill stays 0 at every slider position — never destroys click-selection.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((styles[0] as any).paint['fill-opacity']).toBe(0);
      // Outline scales with the slider but only vanishes at a true 0.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((styles[1] as any).paint['line-opacity']).toBe(1 * factor);
      if (factor > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((styles[1] as any).paint['line-opacity']).toBeGreaterThan(0);
      }
    }

    // Slider back to 100% restores the exact designed look.
    const restored = stylesAt(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((restored[0] as any).paint['fill-opacity']).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((restored[1] as any).paint['line-opacity']).toBe(1);
  });
});

describe('mapStore — active basemap', () => {
  it('setActiveBasemap updates id', () => {
    useMapStore.getState().setActiveBasemap('osm');
    expect(useMapStore.getState().activeBasemapId).toBe('osm');
  });
});

describe('mapStore — imagery', () => {
  beforeEach(() => {
    useMapStore.setState({
      imageryLayers: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'a', type: 'xyz', url: '', visible: false, opacity: 1, exclusive: true } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'b', type: 'xyz', url: '', visible: true, opacity: 1, exclusive: true } as any,
      ],
    });
  });

  it('toggleImageryLayerVisibility hides other exclusive layers when enabling one', () => {
    useMapStore.getState().toggleImageryLayerVisibility('a');
    const layers = useMapStore.getState().imageryLayers;
    expect(layers.find((l) => l.id === 'a')!.visible).toBe(true);
    expect(layers.find((l) => l.id === 'b')!.visible).toBe(false);
  });

  it('toggleImageryLayerVisibility no-ops for unknown ids', () => {
    const before = useMapStore.getState().imageryLayers;
    useMapStore.getState().toggleImageryLayerVisibility('missing');
    expect(useMapStore.getState().imageryLayers).toBe(before);
  });

  it('setImageryLayerOpacity sets opacity for the target', () => {
    useMapStore.getState().setImageryLayerOpacity('b', 0.5);
    expect(useMapStore.getState().imageryLayers.find((l) => l.id === 'b')!.opacity).toBe(0.5);
  });
});

describe('mapStore — filters', () => {
  it('setLayerFilters/setLayerCql2Filter stores per layer', () => {
    useMapStore.getState().setLayerFilters('l1', { name: 'foo' });
    useMapStore.getState().setLayerCql2Filter('l1', {
      op: '=',
      args: [{ property: 'name' }, 'foo'],
    });
    expect(useMapStore.getState().activeFilters.l1).toEqual({ name: 'foo' });
    expect(useMapStore.getState().activeCql2Filters.l1).toEqual({
      op: '=',
      args: [{ property: 'name' }, 'foo'],
    });
  });

  it('clearLayerFilters drops the layer key from both maps', () => {
    useMapStore.getState().setLayerFilters('l1', { name: 'foo' });
    useMapStore.getState().setLayerCql2Filter('l1', { op: '=', args: [{ property: 'x' }, 1] });
    useMapStore.getState().clearLayerFilters('l1');
    expect(useMapStore.getState().activeFilters).toEqual({});
    expect(useMapStore.getState().activeCql2Filters).toEqual({});
  });
});

describe('mapStore — pending camera actions', () => {
  it('fitBounds + clearPendingFitBounds round-trip', () => {
    useMapStore.getState().fitBounds([0, 0, 1, 1], { padding: 10 });
    expect(useMapStore.getState().pendingFitBounds).toEqual([0, 0, 1, 1]);
    expect(useMapStore.getState().pendingFitBoundsOptions).toEqual({ padding: 10 });
    useMapStore.getState().clearPendingFitBounds();
    expect(useMapStore.getState().pendingFitBounds).toBeNull();
    expect(useMapStore.getState().pendingFitBoundsOptions).toBeNull();
  });

  it('flyTo + clearPendingFlyTo round-trip', () => {
    useMapStore.getState().flyTo([10, 20], 5);
    expect(useMapStore.getState().pendingFlyTo).toEqual({ center: [10, 20], zoom: 5 });
    useMapStore.getState().clearPendingFlyTo();
    expect(useMapStore.getState().pendingFlyTo).toBeNull();
  });

  it('requestBearing + clearPendingBearing round-trip', () => {
    useMapStore.getState().requestBearing(90);
    expect(useMapStore.getState().pendingBearing).toBe(90);
    useMapStore.getState().clearPendingBearing();
    expect(useMapStore.getState().pendingBearing).toBeNull();
  });
});

describe('mapStore — global search', () => {
  it('setGlobalSearchQuery short-circuits on equal value', () => {
    useMapStore.getState().setGlobalSearchQuery('hello');
    const snap = useMapStore.getState();
    useMapStore.getState().setGlobalSearchQuery('hello');
    // Reference equality means the no-op branch was taken.
    expect(useMapStore.getState()).toBe(snap);
  });

  it('setGlobalSearchResults short-circuits when both empty', () => {
    const snap = useMapStore.getState();
    useMapStore.getState().setGlobalSearchResults({});
    expect(useMapStore.getState()).toBe(snap);
  });

  it('setGlobalSearchResults stores non-empty results', () => {
    const r = { layer1: { layerId: 'layer1', layerLabel: 'Layer 1', hits: [] } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useMapStore.getState().setGlobalSearchResults(r as any);
    expect(useMapStore.getState().globalSearchResults).toBe(r);
  });

  it('setGlobalSearchIsLoading toggles', () => {
    useMapStore.getState().setGlobalSearchIsLoading(true);
    expect(useMapStore.getState().globalSearchIsLoading).toBe(true);
    useMapStore.getState().setGlobalSearchIsLoading(true); // no-op branch
    expect(useMapStore.getState().globalSearchIsLoading).toBe(true);
  });

  it('cacheDistinctValues stores by key', () => {
    useMapStore.getState().cacheDistinctValues('l1:name', ['a', 'b']);
    expect(useMapStore.getState().prefetchedDistinctValues['l1:name']).toEqual(['a', 'b']);
  });

  it('clearGlobalSearch resets query/results/loading', () => {
    useMapStore.getState().setGlobalSearchQuery('x');
    useMapStore.getState().setGlobalSearchIsLoading(true);
    useMapStore.getState().clearGlobalSearch();
    const s = useMapStore.getState();
    expect(s.globalSearchQuery).toBe('');
    expect(s.globalSearchResults).toEqual({});
    expect(s.globalSearchIsLoading).toBe(false);
  });
});

describe('mapStore — hydrate', () => {
  it('hydrate replaces config-derived slices', () => {
    useMapStore.getState().hydrate({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialView: { latitude: 1, longitude: 2, zoom: 3, pitch: 0, bearing: 0 } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      layers: [makeLayer({ id: 'hl1' })] as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      basemaps: [{ id: 'bm', label: 'BM', url: '' } as any],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sources: [] as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ui: { showLayerPanel: true } as any,
    });
    const s = useMapStore.getState();
    expect(s.viewState.latitude).toBe(1);
    expect(s.layers.map((l) => l.id)).toEqual(['hl1']);
    expect(s.activeBasemapId).toBe('bm');
  });
});

describe('selectors', () => {
  it('useActiveLayerIds returns ids of visible layers only', () => {
    useMapStore.setState({
      layers: [
        makeLayer({ id: 'l1', visible: true }),
        makeLayer({ id: 'l2', visible: false }),
        makeLayer({ id: 'l3', visible: true }),
      ],
    });
    const { result } = renderHook(() => useActiveLayerIds());
    expect(result.current).toEqual(['l1', 'l3']);
  });

  it('useEffectiveCql2Filters returns only the active filter when no base filter', () => {
    useMapStore.setState({
      layers: [makeLayer({ id: 'l1', cql2Filter: null })],
      activeCql2Filters: {
        l1: { op: '>', args: [{ property: 'value' }, 10] },
      },
    });
    const { result } = renderHook(() => useEffectiveCql2Filters());
    expect(result.current.l1).toEqual({ op: '>', args: [{ property: 'value' }, 10] });
  });

  it('useEffectiveCql2Filters AND-merges base and active filters', () => {
    useMapStore.setState({
      layers: [
        makeLayer({
          id: 'l1',
          cql2Filter: {
            combinator: 'and',
            rules: [
              {
                property: 'category',
                operator: '=',
                value: { kind: 'static', value: 'A' },
              },
            ],
          },
        }),
      ],
      activeCql2Filters: {
        l1: { op: '>', args: [{ property: 'value' }, 10] },
      },
    });
    const { result } = renderHook(() => useEffectiveCql2Filters());
    const merged = result.current.l1;
    expect(merged).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((merged as any).op).toBe('and');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((merged as any).args).toHaveLength(2);
  });

  it('useEffectiveCql2Filters omits layers with neither filter', () => {
    useMapStore.setState({
      layers: [makeLayer({ id: 'l1' })],
      activeCql2Filters: {},
    });
    const { result } = renderHook(() => useEffectiveCql2Filters());
    expect(result.current.l1).toBeUndefined();
  });
});
