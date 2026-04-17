import { Fragment, useEffect, useState } from 'react';
import { SourceEditor, BasemapEditor, ConfirmDialog, WmtsSourceEditor } from '@ogc-maps/storybook-components';
import type { OgcApiSource, SourceAuth, BasemapConfig, WmtsSource } from '@ogc-maps/storybook-components';
import { detectTileSourceType, appendAuth, authHeaders } from '@ogc-maps/storybook-components/utils';
import { SourceMetadataPanel } from '../components/SourceMetadataPanel';
import type { InspectionResult } from '../components/SourceMetadataPanel';
import { inspectSourceClientSide } from '../utils/inspectSource';

type SourceTab = 'features' | 'imagery' | 'wmts' | 'basemap';

const TAB_LABELS: Record<SourceTab, string> = {
  features: 'Features',
  imagery: 'Imagery',
  wmts: 'WMTS',
  basemap: 'Basemaps',
};

type BasemapMode = 'style-url' | 'from-imagery';

interface ImageryBasemapDraft {
  source_id: string;
  label: string;
  imagery_source_id: string;
  collection_id: string;
  thumbnail: string;
}

interface SavedSource {
  id: string;
  source_id: string;
  url: string;
  label: string | null;
  tile_matrix_set_id: string;
  source_type: string;
  auth: SourceAuth | null;
  proxy: boolean;
  metadata: (InspectionResult & { thumbnail?: string; imagerySourceId?: string; collectionId?: string; wmtsLayer?: string; wmtsStyle?: string; wmtsFormat?: string }) | null;
  metadata_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

function toOgcApiSource(s: SavedSource): OgcApiSource {
  return {
    id: s.source_id,
    url: s.url,
    label: s.label ?? undefined,
    tileMatrixSetId: s.tile_matrix_set_id,
    type: (s.source_type ?? 'features') as 'features' | 'imagery',
    auth: s.auth ?? undefined,
    proxy: s.proxy,
  };
}

function toWmtsSource(s: SavedSource): WmtsSource {
  return {
    id: s.source_id,
    sourceType: 'wmts',
    capabilitiesUrl: s.url,
    layer: s.metadata?.wmtsLayer ?? '',
    style: s.metadata?.wmtsStyle ?? 'default',
    format: s.metadata?.wmtsFormat ?? 'image/png',
    tileMatrixSet: s.tile_matrix_set_id ?? 'WebMercatorQuad',
    tileSize: 256,
    label: s.label ?? undefined,
    auth: s.auth ?? undefined,
    proxy: s.proxy,
  };
}

function toBasemapConfig(s: SavedSource): BasemapConfig {
  return {
    id: s.source_id,
    label: s.label ?? s.source_id,
    url: s.url,
    thumbnail: s.metadata?.thumbnail,
  };
}

function ImageryBasemapForm({
  draft,
  onChange,
  imagerySources,
}: {
  draft: ImageryBasemapDraft;
  onChange: (draft: ImageryBasemapDraft) => void;
  imagerySources: SavedSource[];
}) {
  const update = (patch: Partial<ImageryBasemapDraft>) => onChange({ ...draft, ...patch });
  const selected = imagerySources.find(s => s.id === draft.imagery_source_id);
  const sourceTypeKind = selected ? detectTileSourceType(selected.url) : null;
  const needsCollection = sourceTypeKind === 'ogc-api';
  const collections = selected?.metadata?.collections ?? [];

  const inputClass =
    'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-3">
      <label className="mapui:flex mapui:flex-col mapui:gap-1">
        <span className="mapui:text-xs mapui:font-medium mapui:text-slate-700">ID *</span>
        <input
          type="text"
          value={draft.source_id}
          onChange={(e) => update({ source_id: e.target.value })}
          placeholder="usgs-topo"
          className={inputClass}
        />
      </label>

      <label className="mapui:flex mapui:flex-col mapui:gap-1">
        <span className="mapui:text-xs mapui:font-medium mapui:text-slate-700">Label</span>
        <input
          type="text"
          value={draft.label}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="USGS Topo"
          className={inputClass}
        />
      </label>

      <label className="mapui:flex mapui:flex-col mapui:gap-1">
        <span className="mapui:text-xs mapui:font-medium mapui:text-slate-700">Imagery source *</span>
        <select
          value={draft.imagery_source_id}
          onChange={(e) => update({ imagery_source_id: e.target.value, collection_id: '' })}
          className={inputClass}
        >
          <option value="">— Select an imagery source —</option>
          {imagerySources.map(s => (
            <option key={s.id} value={s.id}>
              {s.label ?? s.source_id} ({detectTileSourceType(s.url)})
              {s.auth?.type === 'header' ? ' • header auth → proxied' : ''}
            </option>
          ))}
        </select>
        {imagerySources.length === 0 && (
          <span className="mapui:text-xs mapui:text-slate-500">
            No imagery sources available. Add one in the Imagery tab first.
          </span>
        )}
      </label>

      {needsCollection && (
        <label className="mapui:flex mapui:flex-col mapui:gap-1">
          <span className="mapui:text-xs mapui:font-medium mapui:text-slate-700">Collection *</span>
          <select
            value={draft.collection_id}
            onChange={(e) => update({ collection_id: e.target.value })}
            className={inputClass}
          >
            <option value="">— Select a collection —</option>
            {collections.map(c => (
              <option key={c.id} value={c.id}>{c.title ?? c.id}</option>
            ))}
          </select>
          {collections.length === 0 && (
            <span className="mapui:text-xs mapui:text-slate-500">
              No collections found in metadata — refresh the imagery source's metadata first.
            </span>
          )}
        </label>
      )}

      <label className="mapui:flex mapui:flex-col mapui:gap-1">
        <span className="mapui:text-xs mapui:font-medium mapui:text-slate-700">Thumbnail URL (optional)</span>
        <input
          type="url"
          value={draft.thumbnail}
          onChange={(e) => update({ thumbnail: e.target.value })}
          placeholder="https://example.com/thumbnail.png"
          className={inputClass}
        />
      </label>
    </div>
  );
}

function DismissibleAlert({ message, variant, onDismiss }: { message: string; variant: 'error' | 'success'; onDismiss: () => void }) {
  const color = variant === 'error' ? 'red' : 'green';
  return (
    <div className={`mapui:mb-4 mapui:rounded mapui:bg-${color}-50 mapui:border mapui:border-${color}-200 mapui:px-4 mapui:py-3 mapui:flex mapui:items-center mapui:justify-between`}>
      <span className={`mapui:text-sm mapui:text-${color}-700`}>{message}</span>
      <button onClick={onDismiss} className={`mapui:text-${color}-500 mapui:hover:text-${color}-700 mapui:text-lg mapui:leading-none`}>×</button>
    </div>
  );
}

export function SourcesPage() {
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<SourceTab>('basemap');

  // Create/edit state for OGC sources (features/imagery)
  const [addingNew, setAddingNew] = useState(false);
  const [newSource, setNewSource] = useState<OgcApiSource>({ id: '', url: '', tileMatrixSetId: 'WebMercatorQuad' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<OgcApiSource | null>(null);
  const [saving, setSaving] = useState(false);

  // Create/edit state for WMTS sources
  const [addingNewWmts, setAddingNewWmts] = useState(false);
  const defaultWmtsSource: WmtsSource = { id: '', sourceType: 'wmts', capabilitiesUrl: '', layer: '', style: 'default', format: 'image/png', tileMatrixSet: 'WebMercatorQuad', tileSize: 256 };
  const [newWmtsSource, setNewWmtsSource] = useState<WmtsSource>(defaultWmtsSource);
  const [editingWmtsSource, setEditingWmtsSource] = useState<WmtsSource | null>(null);

  // Create/edit state for basemaps
  const [addingNewBasemap, setAddingNewBasemap] = useState(false);
  const [newBasemap, setNewBasemap] = useState<BasemapConfig>({ id: '', label: '', url: '' });
  const [editingBasemap, setEditingBasemap] = useState<BasemapConfig | null>(null);

  // Mode for the basemap create form: a hand-typed Style URL, or one derived
  // from an existing imagery source (the server synthesizes the style.json).
  const [basemapMode, setBasemapMode] = useState<BasemapMode>('style-url');
  const [newImageryBasemap, setNewImageryBasemap] = useState<ImageryBasemapDraft>({
    source_id: '', label: '', imagery_source_id: '', collection_id: '', thumbnail: '',
  });
  const [editingImageryBasemap, setEditingImageryBasemap] = useState<ImageryBasemapDraft | null>(null);

  // Connection test state
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});
  const [testError, setTestError] = useState<Record<string, string>>({});

  // Delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<{ id: string; name: string }[]>([]);

  // Expand/collapse and refresh state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());

  // Derived: filtered sources for active tab
  const filteredSources = sources.filter(s => (s.source_type ?? 'features') === activeTab);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchSources = async () => {
    const res = await fetch('/api/sources');
    setSources(await res.json() as SavedSource[]);
  };

  useEffect(() => {
    setLoading(true);
    fetchSources()
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  // Imagery sources available as the basis for an imagery-derived basemap
  const imagerySourcesForBasemap = sources.filter(s => s.source_type === 'imagery');

  // Reset create/edit state when switching tabs
  useEffect(() => {
    setAddingNew(false);
    setAddingNewWmts(false);
    setAddingNewBasemap(false);
    setEditingId(null);
    setEditingSource(null);
    setEditingWmtsSource(null);
    setEditingBasemap(null);
    setEditingImageryBasemap(null);
    setBasemapMode('style-url');
  }, [activeTab]);

  const handleTestConnection = async (key: string, url: string, auth?: SourceAuth) => {
    setTestStatus(prev => ({ ...prev, [key]: 'loading' }));
    const normalizedUrl = url.trim().replace(/\/$/, '');
    const testUrl = /^https?:\/\//i.test(normalizedUrl) ? normalizedUrl : `http://${normalizedUrl}`;
    const sourceType = detectTileSourceType(testUrl);

    // Style URLs don't belong in the Sources tab — reject immediately.
    if (sourceType === 'style') {
      setTestStatus(prev => ({ ...prev, [key]: 'error' }));
      setTestError(prev => ({
        ...prev,
        [key]: 'Style URLs belong in the Basemaps tab — use "Style URL" mode there.',
      }));
      return;
    }

    // Try client-side first (browser fetches directly)
    try {
      let testEndpoint: string;
      let acceptHeader = 'application/json';
      if (sourceType === 'tilejson') {
        testEndpoint = appendAuth(testUrl, auth ?? undefined);
      } else if (sourceType === 'xyz') {
        testEndpoint = appendAuth(
          testUrl.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0'),
          auth ?? undefined,
        );
        acceptHeader = '*/*';
      } else {
        testEndpoint = appendAuth(`${testUrl}/conformance?f=json`, auth ?? undefined);
      }

      const res = await fetch(testEndpoint, {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: acceptHeader, ...authHeaders(auth ?? undefined) },
      });
      if (res.ok) {
        // For TileJSON, also verify structure
        if (sourceType === 'tilejson') {
          const data = await res.json();
          if (!data.tiles || !Array.isArray(data.tiles)) {
            throw new Error('Invalid TileJSON: missing tiles array');
          }
        }
        setTestStatus(prev => ({ ...prev, [key]: 'success' }));
        return;
      }
    } catch (err) {
      // Client-side failed (CORS/network) — fall through to server-side
      console.error('Client-side test connection failed:', err);
    }

    // Server-side fallback
    try {
      const res = await fetch('/api/sources/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url, auth }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setTestStatus(prev => ({ ...prev, [key]: 'success' }));
      } else {
        setTestStatus(prev => ({ ...prev, [key]: 'error' }));
        setTestError(prev => ({ ...prev, [key]: data.error ?? 'Connection failed' }));
      }
    } catch (err) {
      setTestStatus(prev => ({ ...prev, [key]: 'error' }));
      setTestError(prev => ({ ...prev, [key]: err instanceof Error ? err.message : 'Network error' }));
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    setActionError(null);
    try {
      // Try client-side inspection first
      let clientMetadata: InspectionResult | undefined;
      try {
        clientMetadata = await inspectSourceClientSide(newSource.url, newSource.auth);
      } catch {
        // Client-side inspection failed (CORS/network) — server will auto-inspect
      }

      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_id: newSource.id,
          url: newSource.url,
          label: newSource.label || null,
          tile_matrix_set_id: newSource.tileMatrixSetId || 'WebMercatorQuad',
          source_type: activeTab,
          auth: newSource.auth ?? null,
          proxy: newSource.proxy ?? false,
          ...(clientMetadata ? { metadata: clientMetadata } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setActionError(data.error);
        return;
      }
      const created = await res.json() as SavedSource;
      setAddingNew(false);
      setNewSource({ id: '', url: '', tileMatrixSetId: 'WebMercatorQuad' });
      await fetchSources();
      setExpandedIds(prev => new Set(prev).add(created.id));
    } catch (err) {
      setActionError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateWmts = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const src = newWmtsSource;
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_id: src.id,
          url: src.capabilitiesUrl,
          label: src.label || null,
          tile_matrix_set_id: src.tileMatrixSet,
          source_type: 'wmts',
          auth: src.auth ?? null,
          proxy: src.proxy ?? false,
          metadata: {
            wmtsLayer: src.layer,
            wmtsStyle: src.style,
            wmtsFormat: src.format,
            collections: [],
            inspectedAt: new Date().toISOString(),
            errors: [],
            landing: null,
            conformance: null,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setActionError(data.error);
        return;
      }
      const created = await res.json() as SavedSource;
      setAddingNewWmts(false);
      setNewWmtsSource(defaultWmtsSource);
      await fetchSources();
      setExpandedIds(prev => new Set(prev).add(created.id));
    } catch (err) {
      setActionError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateWmts = async () => {
    if (!editingId || !editingWmtsSource) return;
    setSaving(true);
    setActionError(null);
    try {
      const src = editingWmtsSource;
      const res = await fetch(`/api/sources/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_id: src.id,
          url: src.capabilitiesUrl,
          label: src.label || null,
          tile_matrix_set_id: src.tileMatrixSet,
          source_type: 'wmts',
          auth: src.auth ?? null,
          proxy: src.proxy ?? false,
          metadata: {
            wmtsLayer: src.layer,
            wmtsStyle: src.style,
            wmtsFormat: src.format,
            collections: [],
            inspectedAt: new Date().toISOString(),
            errors: [],
            landing: null,
            conformance: null,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setActionError(data.error);
        return;
      }
      setEditingId(null);
      setEditingWmtsSource(null);
      await fetchSources();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBasemap = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_id: newBasemap.id,
          url: newBasemap.url,
          label: newBasemap.label || null,
          source_type: 'basemap',
          thumbnail: newBasemap.thumbnail || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setActionError(data.error);
        return;
      }
      setAddingNewBasemap(false);
      setNewBasemap({ id: '', label: '', url: '' });
      await fetchSources();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateImageryBasemap = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const draft = newImageryBasemap;
      const imagerySource = sources.find(s => s.id === draft.imagery_source_id);
      const sourceTypeKind = imagerySource ? detectTileSourceType(imagerySource.url) : 'ogc-api';
      if (sourceTypeKind === 'style') {
        setActionError(
          'This imagery source is a MapLibre style document. Create the basemap in "Style URL" mode instead.',
        );
        return;
      }
      const needsCollection = sourceTypeKind === 'ogc-api';
      if (needsCollection && !draft.collection_id) {
        setActionError('Pick a collection for this OGC API imagery source.');
        return;
      }
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_id: draft.source_id,
          label: draft.label || null,
          source_type: 'basemap',
          imagery_source_id: draft.imagery_source_id,
          collection_id: needsCollection ? draft.collection_id : null,
          thumbnail: draft.thumbnail || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setActionError(data.error);
        return;
      }
      setAddingNewBasemap(false);
      setNewImageryBasemap({ source_id: '', label: '', imagery_source_id: '', collection_id: '', thumbnail: '' });
      setBasemapMode('style-url');
      await fetchSources();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateImageryBasemap = async () => {
    if (!editingId || !editingImageryBasemap) return;
    setSaving(true);
    setActionError(null);
    try {
      const draft = editingImageryBasemap;
      const imagerySource = sources.find(s => s.id === draft.imagery_source_id);
      const sourceTypeKind = imagerySource ? detectTileSourceType(imagerySource.url) : 'ogc-api';
      if (sourceTypeKind === 'style') {
        setActionError(
          'This imagery source is a MapLibre style document. Create the basemap in "Style URL" mode instead.',
        );
        return;
      }
      const needsCollection = sourceTypeKind === 'ogc-api';
      if (needsCollection && !draft.collection_id) {
        setActionError('Pick a collection for this OGC API imagery source.');
        return;
      }
      const res = await fetch(`/api/sources/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_id: draft.source_id,
          label: draft.label || null,
          source_type: 'basemap',
          imagery_source_id: draft.imagery_source_id,
          collection_id: needsCollection ? draft.collection_id : null,
          thumbnail: draft.thumbnail || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setActionError(data.error);
        return;
      }
      setEditingId(null);
      setEditingImageryBasemap(null);
      await fetchSources();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !editingSource) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/sources/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_id: editingSource.id,
          url: editingSource.url,
          label: editingSource.label || null,
          tile_matrix_set_id: editingSource.tileMatrixSetId || 'WebMercatorQuad',
          source_type: activeTab,
          auth: editingSource.auth ?? null,
          proxy: editingSource.proxy ?? false,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setActionError(data.error);
        return;
      }
      setEditingId(null);
      setEditingSource(null);
      await fetchSources();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateBasemap = async () => {
    if (!editingId || !editingBasemap) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/sources/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_id: editingBasemap.id,
          url: editingBasemap.url,
          label: editingBasemap.label || null,
          source_type: 'basemap',
          thumbnail: editingBasemap.thumbnail || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setActionError(data.error);
        return;
      }
      setEditingId(null);
      setEditingBasemap(null);
      await fetchSources();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = async (source: SavedSource) => {
    try {
      const res = await fetch(`/api/sources/${source.id}/usage`);
      const data = await res.json() as { configs: { id: string; name: string }[] };
      setDeleteUsage(data.configs ?? []);
    } catch {
      setDeleteUsage([]);
    }
    setConfirmDeleteId(source.id);
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/sources/${confirmDeleteId}?force=true`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        setActionError(`Delete failed: ${await res.text()}`);
        return;
      }
      setSources(prev => prev.filter(s => s.id !== confirmDeleteId));
    } catch (err) {
      setActionError(String(err));
    } finally {
      setConfirmDeleteId(null);
      setDeleteUsage([]);
    }
  };

  const handleImport = async () => {
    setActionError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/sources/import', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setActionError(`Import failed: ${await res.text()}`);
        return;
      }
      const data = await res.json() as { imported: { features: number; imagery: number; basemaps: number }; total: number };
      const parts: string[] = [];
      if (data.imported.features > 0) parts.push(`${data.imported.features} feature`);
      if (data.imported.imagery > 0) parts.push(`${data.imported.imagery} imagery`);
      if (data.imported.basemaps > 0) parts.push(`${data.imported.basemaps} basemap`);
      setSuccessMessage(
        parts.length > 0
          ? `Imported ${parts.join(', ')} source(s) from existing configs (${data.total} unique found).`
          : `No new sources to import (${data.total} unique found, all already exist).`,
      );
      await fetchSources();
    } catch (err) {
      setActionError(String(err));
    }
  };

  const handleRefreshMetadata = async (source: SavedSource) => {
    setRefreshingIds(prev => new Set(prev).add(source.id));
    try {
      // Try client-side inspection first
      let succeeded = false;
      try {
        const metadata = await inspectSourceClientSide(source.url, source.auth ?? undefined);
        const res = await fetch(`/api/sources/${source.id}/metadata`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ metadata }),
        });
        if (res.ok) {
          const updated = await res.json() as SavedSource;
          setSources(prev => prev.map(s => s.id === source.id ? updated : s));
          succeeded = true;
        }
      } catch {
        // Client-side failed — fall through to server-side
      }

      if (!succeeded) {
        // Server-side fallback
        const res = await fetch(`/api/sources/${source.id}/inspect`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) {
          const updated = await res.json() as SavedSource;
          setSources(prev => prev.map(s => s.id === source.id ? updated : s));
        } else {
          setActionError(`Inspect failed: ${await res.text()}`);
        }
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  };

  const handleAddNew = () => {
    if (activeTab === 'basemap') {
      setAddingNewBasemap(true);
      setNewBasemap({ id: '', label: '', url: '' });
      setNewImageryBasemap({ source_id: '', label: '', imagery_source_id: '', collection_id: '', thumbnail: '' });
      setBasemapMode('style-url');
    } else if (activeTab === 'wmts') {
      setAddingNewWmts(true);
      setNewWmtsSource(defaultWmtsSource);
    } else {
      setAddingNew(true);
      setNewSource({ id: '', url: '', tileMatrixSetId: 'WebMercatorQuad', type: activeTab });
    }
  };

  const isBasemapTab = activeTab === 'basemap';
  const colCount = isBasemapTab ? 6 : 7;

  if (loading) return <div className="mapui:p-8 mapui:text-center mapui:text-slate-500">Loading...</div>;

  return (
    <div className="mapui:p-8">
      <div className="mapui:flex mapui:items-center mapui:justify-between mapui:mb-6">
        <h1 className="mapui:text-2xl mapui:font-bold mapui:text-slate-900">Sources</h1>
        <div className="mapui:flex mapui:gap-2">
          <button
            onClick={handleImport}
            className="mapui:border mapui:border-slate-300 mapui:text-slate-700 mapui:px-4 mapui:py-2 mapui:rounded mapui:hover:bg-slate-50 mapui:text-sm"
          >
            Import from Configs
          </button>
          <button
            onClick={handleAddNew}
            className="mapui:bg-blue-600 mapui:text-white mapui:px-4 mapui:py-2 mapui:rounded mapui:hover:bg-blue-700 mapui:text-sm"
          >
            {isBasemapTab ? 'Add Basemap' : 'Create New Source'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mapui:flex mapui:gap-1 mapui:mb-4 mapui:border-b mapui:border-slate-200">
        {(['basemap', 'imagery', 'wmts', 'features'] as const).map(tab => {
          const count = sources.filter(s => (s.source_type ?? 'features') === tab).length;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`mapui:px-4 mapui:py-2 mapui:text-sm mapui:font-medium mapui:border-b-2 mapui:transition-colors ${
                activeTab === tab
                  ? 'mapui:border-blue-600 mapui:text-blue-600'
                  : 'mapui:border-transparent mapui:text-slate-500 mapui:hover:text-slate-700 mapui:hover:border-slate-300'
              }`}
            >
              {TAB_LABELS[tab]}
              {count > 0 && (
                <span className="mapui:ml-1.5 mapui:rounded-full mapui:bg-slate-100 mapui:px-2 mapui:py-0.5 mapui:text-xs mapui:text-slate-600">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && <DismissibleAlert message={error} variant="error" onDismiss={() => setError(null)} />}
      {actionError && <DismissibleAlert message={actionError} variant="error" onDismiss={() => setActionError(null)} />}
      {successMessage && <DismissibleAlert message={successMessage} variant="success" onDismiss={() => setSuccessMessage(null)} />}

      {/* Create new OGC source form (features/imagery) */}
      {addingNew && !isBasemapTab && (
        <div className="mapui:mb-6 mapui:bg-white mapui:rounded-lg mapui:shadow mapui:p-6">
          <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800 mapui:mb-4">New {activeTab === 'imagery' ? 'Imagery' : 'Feature'} Source</h2>
          <SourceEditor
            value={newSource}
            onChange={setNewSource}
            onTestConnection={(url, auth) => handleTestConnection('new', url, auth)}
            testStatus={testStatus['new']}
            testError={testError['new']}
          />
          <div className="mapui:mt-4 mapui:flex mapui:gap-2">
            <button
              onClick={handleCreate}
              disabled={saving || !newSource.id || !newSource.url}
              className="mapui:bg-blue-600 mapui:text-white mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Source'}
            </button>
            <button
              onClick={() => setAddingNew(false)}
              className="mapui:border mapui:border-slate-300 mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create new WMTS source form */}
      {addingNewWmts && activeTab === 'wmts' && (
        <div className="mapui:mb-6 mapui:bg-white mapui:rounded-lg mapui:shadow mapui:p-6">
          <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800 mapui:mb-4">New WMTS Source</h2>
          <WmtsSourceEditor value={newWmtsSource} onChange={setNewWmtsSource} />
          <div className="mapui:mt-4 mapui:flex mapui:gap-2">
            <button
              onClick={handleCreateWmts}
              disabled={saving || !newWmtsSource.id || !newWmtsSource.capabilitiesUrl || !newWmtsSource.layer}
              className="mapui:bg-blue-600 mapui:text-white mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save WMTS Source'}
            </button>
            <button
              onClick={() => setAddingNewWmts(false)}
              className="mapui:border mapui:border-slate-300 mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create new basemap form */}
      {addingNewBasemap && isBasemapTab && (
        <div className="mapui:mb-6 mapui:bg-white mapui:rounded-lg mapui:shadow mapui:p-6">
          <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800 mapui:mb-4">New Basemap</h2>

          <div className="mapui:mb-4 mapui:flex mapui:gap-4 mapui:text-sm">
            <label className="mapui:flex mapui:items-center mapui:gap-1.5">
              <input
                type="radio"
                name="basemap-mode-new"
                checked={basemapMode === 'style-url'}
                onChange={() => setBasemapMode('style-url')}
              />
              Style URL
            </label>
            <label className="mapui:flex mapui:items-center mapui:gap-1.5">
              <input
                type="radio"
                name="basemap-mode-new"
                checked={basemapMode === 'from-imagery'}
                onChange={() => setBasemapMode('from-imagery')}
              />
              From imagery source
            </label>
          </div>

          {basemapMode === 'style-url' ? (
            <>
              <BasemapEditor value={newBasemap} onChange={setNewBasemap} />
              <div className="mapui:mt-4 mapui:flex mapui:gap-2">
                <button
                  onClick={handleCreateBasemap}
                  disabled={saving || !newBasemap.id || !newBasemap.url}
                  className="mapui:bg-blue-600 mapui:text-white mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Basemap'}
                </button>
                <button
                  onClick={() => setAddingNewBasemap(false)}
                  className="mapui:border mapui:border-slate-300 mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <ImageryBasemapForm
              draft={newImageryBasemap}
              onChange={setNewImageryBasemap}
              imagerySources={imagerySourcesForBasemap}
            />
          )}

          {basemapMode === 'from-imagery' && (
            <div className="mapui:mt-4 mapui:flex mapui:gap-2">
              <button
                onClick={handleCreateImageryBasemap}
                disabled={saving || !newImageryBasemap.source_id || !newImageryBasemap.imagery_source_id}
                className="mapui:bg-blue-600 mapui:text-white mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Basemap'}
              </button>
              <button
                onClick={() => setAddingNewBasemap(false)}
                className="mapui:border mapui:border-slate-300 mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {filteredSources.length === 0 && !addingNew && !addingNewBasemap ? (
        <div className="mapui:text-center mapui:text-slate-500 mapui:py-12">
          {isBasemapTab
            ? 'No basemaps saved yet. Add one or import from existing configs.'
            : `No ${activeTab} sources saved yet. Create one or import from existing configs.`}
        </div>
      ) : filteredSources.length > 0 && (
        <div className="mapui:bg-white mapui:rounded-lg mapui:shadow mapui:overflow-visible">
          <table className="mapui:w-full">
            <thead className="mapui:bg-slate-50 mapui:text-left">
              <tr>
                {!isBasemapTab && (
                  <th className="mapui:px-3 mapui:py-3 mapui:text-sm mapui:font-medium mapui:text-slate-600 mapui:w-8"></th>
                )}
                <th className="mapui:px-4 mapui:py-3 mapui:text-sm mapui:font-medium mapui:text-slate-600">Source ID</th>
                <th className="mapui:px-4 mapui:py-3 mapui:text-sm mapui:font-medium mapui:text-slate-600">
                  {isBasemapTab ? 'Style URL' : 'URL'}
                </th>
                <th className="mapui:px-4 mapui:py-3 mapui:text-sm mapui:font-medium mapui:text-slate-600">Label</th>
                {isBasemapTab ? (
                  <th className="mapui:px-4 mapui:py-3 mapui:text-sm mapui:font-medium mapui:text-slate-600">Thumbnail</th>
                ) : (
                  <th className="mapui:px-4 mapui:py-3 mapui:text-sm mapui:font-medium mapui:text-slate-600">Collections</th>
                )}
                <th className="mapui:px-4 mapui:py-3 mapui:text-sm mapui:font-medium mapui:text-slate-600">Updated</th>
                <th className="mapui:px-4 mapui:py-3 mapui:text-sm mapui:font-medium mapui:text-slate-600"></th>
              </tr>
            </thead>
            <tbody className="mapui:divide-y mapui:divide-slate-200">
              {filteredSources.map(source => (
                <Fragment key={source.id}>
                  <tr>
                    {/* Editing row (WMTS source) */}
                    {editingId === source.id && source.source_type === 'wmts' ? (
                      <td colSpan={colCount} className="mapui:px-6 mapui:py-4">
                        <WmtsSourceEditor
                          value={editingWmtsSource ?? toWmtsSource(source)}
                          onChange={setEditingWmtsSource}
                        />
                        <div className="mapui:mt-3 mapui:flex mapui:gap-2">
                          <button
                            onClick={handleUpdateWmts}
                            disabled={saving || !editingWmtsSource?.id || !editingWmtsSource?.capabilitiesUrl}
                            className="mapui:bg-blue-600 mapui:text-white mapui:px-3 mapui:py-1.5 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditingWmtsSource(null); }}
                            className="mapui:border mapui:border-slate-300 mapui:px-3 mapui:py-1.5 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    ) : editingId === source.id && !isBasemapTab ? (
                      <td colSpan={colCount} className="mapui:px-6 mapui:py-4">
                        <SourceEditor
                          value={editingSource ?? toOgcApiSource(source)}
                          onChange={setEditingSource}
                          onTestConnection={(url, auth) => handleTestConnection(`edit-${source.id}`, url, auth)}
                          testStatus={testStatus[`edit-${source.id}`]}
                          testError={testError[`edit-${source.id}`]}
                        />
                        <div className="mapui:mt-3 mapui:flex mapui:gap-2">
                          <button
                            onClick={handleUpdate}
                            disabled={saving || !editingSource?.id || !editingSource?.url}
                            className="mapui:bg-blue-600 mapui:text-white mapui:px-3 mapui:py-1.5 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditingSource(null); }}
                            className="mapui:border mapui:border-slate-300 mapui:px-3 mapui:py-1.5 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    ) : editingId === source.id && isBasemapTab ? (
                      /* Editing row (basemap) — either Style URL or imagery-derived */
                      <td colSpan={colCount} className="mapui:px-6 mapui:py-4">
                        {editingImageryBasemap ? (
                          <>
                            <ImageryBasemapForm
                              draft={editingImageryBasemap}
                              onChange={setEditingImageryBasemap}
                              imagerySources={imagerySourcesForBasemap}
                            />
                            <div className="mapui:mt-3 mapui:flex mapui:gap-2">
                              <button
                                onClick={handleUpdateImageryBasemap}
                                disabled={saving || !editingImageryBasemap.source_id || !editingImageryBasemap.imagery_source_id}
                                className="mapui:bg-blue-600 mapui:text-white mapui:px-3 mapui:py-1.5 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
                              >
                                {saving ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingId(null); setEditingImageryBasemap(null); }}
                                className="mapui:border mapui:border-slate-300 mapui:px-3 mapui:py-1.5 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <BasemapEditor
                              value={editingBasemap ?? toBasemapConfig(source)}
                              onChange={setEditingBasemap}
                            />
                            <div className="mapui:mt-3 mapui:flex mapui:gap-2">
                              <button
                                onClick={handleUpdateBasemap}
                                disabled={saving || !editingBasemap?.id || !editingBasemap?.url}
                                className="mapui:bg-blue-600 mapui:text-white mapui:px-3 mapui:py-1.5 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
                              >
                                {saving ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingId(null); setEditingBasemap(null); }}
                                className="mapui:border mapui:border-slate-300 mapui:px-3 mapui:py-1.5 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        )}
                      </td>
                    ) : (
                      /* Display row */
                      <>
                        {!isBasemapTab && (
                          <td className="mapui:px-3 mapui:py-4">
                            <button
                              onClick={() => toggleExpanded(source.id)}
                              className="mapui:text-slate-400 mapui:hover:text-slate-600"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`mapui:transition-transform ${expandedIds.has(source.id) ? 'mapui:rotate-90' : ''}`}
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </button>
                          </td>
                        )}
                        <td className="mapui:px-4 mapui:py-4 mapui:font-medium mapui:font-mono mapui:text-sm mapui:text-slate-900">{source.source_id}</td>
                        <td className="mapui:px-4 mapui:py-4 mapui:text-slate-500 mapui:text-sm mapui:font-mono mapui:max-w-xs mapui:truncate">
                          {source.url}
                          {isBasemapTab && source.metadata?.imagerySourceId && (() => {
                            const linked = sources.find(s => s.id === source.metadata!.imagerySourceId);
                            return (
                              <div className="mapui:text-xs mapui:text-slate-400 mapui:mt-0.5">
                                ↳ from imagery: {linked?.label ?? linked?.source_id ?? source.metadata.imagerySourceId}
                                {source.metadata.collectionId ? ` / ${source.metadata.collectionId}` : ''}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="mapui:px-4 mapui:py-4 mapui:text-slate-500 mapui:text-sm">{source.label ?? '—'}</td>
                        {isBasemapTab ? (
                          <td className="mapui:px-4 mapui:py-4 mapui:text-sm">
                            {source.metadata?.thumbnail ? (
                              <img
                                src={source.metadata.thumbnail}
                                alt="Thumbnail"
                                className="mapui:h-8 mapui:w-12 mapui:rounded mapui:border mapui:border-slate-200 mapui:object-cover"
                              />
                            ) : (
                              <span className="mapui:text-slate-400">—</span>
                            )}
                          </td>
                        ) : source.source_type === 'wmts' ? (
                          <td className="mapui:px-4 mapui:py-4 mapui:text-slate-500 mapui:text-sm mapui:font-mono mapui:text-xs">
                            {source.metadata?.wmtsLayer ?? '—'}
                          </td>
                        ) : (
                          <td className="mapui:px-4 mapui:py-4 mapui:text-slate-500 mapui:text-sm">
                            {source.metadata?.collections?.length ?? '—'}
                          </td>
                        )}
                        <td className="mapui:px-4 mapui:py-4 mapui:text-slate-500 mapui:text-sm">
                          {new Date(source.updated_at).toLocaleDateString()}
                        </td>
                        <td className="mapui:px-4 mapui:py-4">
                          <div className="mapui:flex mapui:gap-2">
                            <button
                              onClick={() => {
                                setEditingId(source.id);
                                if (source.source_type === 'wmts') {
                                  setEditingWmtsSource(toWmtsSource(source));
                                } else if (isBasemapTab) {
                                  if (source.metadata?.imagerySourceId) {
                                    setEditingImageryBasemap({
                                      source_id: source.source_id,
                                      label: source.label ?? '',
                                      imagery_source_id: source.metadata.imagerySourceId,
                                      collection_id: source.metadata.collectionId ?? '',
                                      thumbnail: source.metadata.thumbnail ?? '',
                                    });
                                    setEditingBasemap(null);
                                  } else {
                                    setEditingBasemap(toBasemapConfig(source));
                                    setEditingImageryBasemap(null);
                                  }
                                } else {
                                  setEditingSource(toOgcApiSource(source));
                                }
                              }}
                              className="mapui:text-blue-600 mapui:hover:text-blue-800 mapui:text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteClick(source)}
                              className="mapui:text-red-600 mapui:hover:text-red-800 mapui:text-sm"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                  {/* Metadata expansion for OGC sources only */}
                  {!isBasemapTab && expandedIds.has(source.id) && editingId !== source.id && (
                    <tr>
                      <td colSpan={colCount} className="mapui:p-0">
                        <SourceMetadataPanel
                          metadata={source.metadata}
                          metadataUpdatedAt={source.metadata_updated_at}
                          sourceUrl={source.url}
                          onRefresh={() => handleRefreshMetadata(source)}
                          refreshing={refreshingIds.has(source.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={isBasemapTab ? 'Delete Basemap' : 'Delete Source'}
        description={
          deleteUsage.length > 0
            ? `This source is used by ${deleteUsage.length} config(s): ${deleteUsage.map(c => c.name).join(', ')}. Deleting it will not affect existing configs (sources are embedded in config data), but it will no longer be available for reuse.`
            : `Are you sure you want to delete this ${isBasemapTab ? 'basemap' : 'source'}?`
        }
        onConfirm={handleDelete}
        onCancel={() => { setConfirmDeleteId(null); setDeleteUsage([]); }}
      />
    </div>
  );
}
