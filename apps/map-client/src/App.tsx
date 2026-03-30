import { useEffect, useState, useCallback } from 'react';
import { safeValidateMapConfig } from '@ogc-maps/storybook-components/schemas';
import type { BrandingConfig } from '@ogc-maps/storybook-components/types';
import { useMapStore } from './stores/mapStore';
import { useMapSync } from './hooks/useMapSync';
import { Layout } from './components/Layout';
import { CachedConfigBanner } from './components/CachedConfigBanner';

const CACHE_KEY = 'mapui:cached-config';
const CACHE_TS_KEY = 'mapui:cached-config-timestamp';

function applyBranding(branding: BrandingConfig | undefined) {
  if (branding?.browserTitle) document.title = branding.browserTitle;
  if (branding?.faviconDataUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = branding.faviconDataUrl;
  }
}

function App() {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [usingCachedConfig, setUsingCachedConfig] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState<number>(0);
  const hydrate = useMapStore((s) => s.hydrate);

  const loadConfig = useCallback(async () => {
    // Extract config name from URL path (e.g., /demo → "demo", / → "default")
    const pathSegment = window.location.pathname.replace(/^\//, '').split('/')[0];
    const configName = pathSegment || 'default';

    try {
      const res = await fetch(`/api/configs/${configName}`);

      // For "default" config, fall back to local config.json on 404 (standalone mode)
      if (!res.ok && configName === 'default') {
        const fallbackRes = await fetch('/config.json');
        if (!fallbackRes.ok) throw new Error(`HTTP ${fallbackRes.status} ${fallbackRes.statusText}`);
        const raw: unknown = await fallbackRes.json();
        const result = safeValidateMapConfig(raw);
        if (!result.success) {
          setValidationError(
            `Config validation failed: ${result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
          );
          return;
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
        localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
        hydrate(result.data);
        applyBranding(result.data.branding);
        setUsingCachedConfig(false);
        setIsReady(true);
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const raw: unknown = await res.json();

      const result = safeValidateMapConfig(raw);
      if (!result.success) {
        setValidationError(
          `Config validation failed: ${result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
        return;
      }

      // Cache successful config
      localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
      localStorage.setItem(CACHE_TS_KEY, String(Date.now()));

      hydrate(result.data);
      applyBranding(result.data.branding);
      setUsingCachedConfig(false);
      setIsReady(true);
    } catch {
      // Network failure — try localStorage cache
      const cachedRaw = localStorage.getItem(CACHE_KEY);
      const cachedTs = localStorage.getItem(CACHE_TS_KEY);

      if (cachedRaw) {
        try {
          const parsed: unknown = JSON.parse(cachedRaw);
          const result = safeValidateMapConfig(parsed);
          if (result.success) {
            hydrate(result.data);
            applyBranding(result.data.branding);
            setUsingCachedConfig(true);
            setCacheTimestamp(cachedTs ? Number(cachedTs) : Date.now());
            setIsReady(true);
            return;
          }
        } catch {
          // Cached value is corrupt — fall through to error
        }
      }

      setValidationError(
        `Failed to load config "${configName}" and no cached config is available.`
      );
    }
  }, [hydrate]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  if (validationError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-red-50">
        <div className="max-w-2xl rounded-lg bg-white p-8 shadow-lg">
          <h1 className="text-2xl font-bold text-red-600">Configuration Error</h1>
          <p className="mt-4 text-gray-700">{validationError}</p>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="text-lg text-gray-600">Loading map configuration...</div>
        </div>
      </div>
    );
  }

  return <AppContent usingCachedConfig={usingCachedConfig} cacheTimestamp={cacheTimestamp} onRetry={loadConfig} />;
}

function AppContent({
  usingCachedConfig,
  cacheTimestamp,
  onRetry,
}: {
  usingCachedConfig: boolean;
  cacheTimestamp: number;
  onRetry: () => void;
}) {
  // Enable URL state sync after hydration is complete
  useMapSync();

  const uiConfig = useMapStore((s) => s.uiConfig);

  return (
    <>
      {usingCachedConfig && (
        <CachedConfigBanner timestamp={cacheTimestamp} onRetry={onRetry} />
      )}
      <Layout uiConfig={uiConfig} />
    </>
  );
}

export default App;
