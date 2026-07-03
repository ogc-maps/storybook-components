import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../uiStore';

const initialState = useUIStore.getState();

beforeEach(() => {
  useUIStore.setState({ ...initialState }, true);
});

describe('uiStore — initial state', () => {
  it('defaults to sidebar open', () => {
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('defaults to no active panel', () => {
    expect(useUIStore.getState().activePanel).toBeNull();
  });

  it('defaults to not loading', () => {
    expect(useUIStore.getState().isLoading).toBe(false);
  });
});

describe('uiStore — toggleSidebar', () => {
  it('closes an open sidebar', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  it('re-opens after a second toggle', () => {
    useUIStore.getState().toggleSidebar();
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('toggles from a closed state', () => {
    useUIStore.setState({ sidebarOpen: false });
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });
});

describe('uiStore — setActivePanel', () => {
  it('sets the layers panel', () => {
    useUIStore.getState().setActivePanel('layers');
    expect(useUIStore.getState().activePanel).toBe('layers');
  });

  it('sets the legend panel', () => {
    useUIStore.getState().setActivePanel('legend');
    expect(useUIStore.getState().activePanel).toBe('legend');
  });

  it('sets the basemaps panel', () => {
    useUIStore.getState().setActivePanel('basemaps');
    expect(useUIStore.getState().activePanel).toBe('basemaps');
  });

  it('clears the active panel with null', () => {
    useUIStore.getState().setActivePanel('layers');
    useUIStore.getState().setActivePanel(null);
    expect(useUIStore.getState().activePanel).toBeNull();
  });

  it('switches between panels', () => {
    useUIStore.getState().setActivePanel('legend');
    useUIStore.getState().setActivePanel('basemaps');
    expect(useUIStore.getState().activePanel).toBe('basemaps');
  });
});

describe('uiStore — setLoading', () => {
  it('sets loading to true', () => {
    useUIStore.getState().setLoading(true);
    expect(useUIStore.getState().isLoading).toBe(true);
  });

  it('sets loading to false', () => {
    useUIStore.setState({ isLoading: true });
    useUIStore.getState().setLoading(false);
    expect(useUIStore.getState().isLoading).toBe(false);
  });

  it('idempotent: setting false when already false', () => {
    useUIStore.getState().setLoading(false);
    expect(useUIStore.getState().isLoading).toBe(false);
  });
});

describe('uiStore — independent state slices', () => {
  it('toggleSidebar does not affect activePanel', () => {
    useUIStore.getState().setActivePanel('legend');
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().activePanel).toBe('legend');
  });

  it('setLoading does not affect sidebarOpen', () => {
    useUIStore.getState().setLoading(true);
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });
});
