import { useCallback, useEffect, useState } from 'react';

/**
 * Module-level clipboard + recent colors store.
 *
 * Kept outside React state so every `ColorPicker` instance shares a single
 * copy buffer and recent palette without coupling to Zustand (the lib is
 * framework-agnostic). Subscribers re-render via `useSyncExternalStore`-style
 * listeners.
 *
 * Storage:
 * - `clipboard`: in-memory only (session-scoped). Survives copy → paste
 *   across components in one page session; does not persist across reload.
 * - `recents`: persisted to `localStorage` under `mapui:recent-colors`,
 *   capped at `MAX_RECENTS`.
 *
 * OS clipboard (`navigator.clipboard.writeText`) is attempted as a
 * best-effort side-channel for the copy, but the UI's success path does
 * NOT depend on it — the deployed instance is plain HTTP, where the OS
 * clipboard API is gated in many browsers.
 */

const RECENTS_KEY = 'mapui:recent-colors';
const MAX_RECENTS = 8;
const COPIED_TIMEOUT_MS = 1500;

type Listener = () => void;

let clipboard: string | null = null;
let recents: string[] = loadRecents();
const listeners = new Set<Listener>();

function loadRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function persistRecents(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

function notify(): void {
  listeners.forEach((l) => l());
}

function normalize(hex: string): string {
  return hex.trim().toLowerCase();
}

function setClipboard(hex: string | null): void {
  clipboard = hex;
  notify();
}

/** Push a color onto the recents list (MRU, deduped, capped). */
export function pushRecentColor(hex: string): void {
  if (!hex) return;
  const v = normalize(hex);
  if (!/^#[0-9a-f]{3,8}$/i.test(v)) return;
  const without = recents.filter((c) => c !== v);
  recents = [v, ...without].slice(0, MAX_RECENTS);
  persistRecents();
  notify();
}

/** Test helper / reset path. */
export function _resetColorClipboardForTests(): void {
  clipboard = null;
  recents = [];
  notify();
}

/** Test helper: read the current recents list without going through the hook. */
export function _getRecentColorsForTests(): readonly string[] {
  return recents;
}

export interface UseColorClipboardResult {
  /** The most recently copied color, or null if nothing has been copied. */
  clipboard: string | null;
  /** True for ~1.5s after the most recent `copy()` call (for "Copied!" UI). */
  copied: boolean;
  /** Recent colors, most-recent first. */
  recents: string[];
  /** Copy a color to the session clipboard (and best-effort OS clipboard). */
  copy: (hex: string) => void;
  /** Return the session clipboard color, or null if empty. */
  paste: () => string | null;
}

export function useColorClipboard(): UseColorClipboardResult {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener: Listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  useEffect(() => {
    if (copiedAt == null) return;
    const t = window.setTimeout(() => setCopiedAt(null), COPIED_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [copiedAt]);

  const copy = useCallback((hex: string) => {
    if (!hex) return;
    const v = normalize(hex);
    setClipboard(v);
    setCopiedAt(Date.now());
    // Best-effort OS clipboard. Silently ignore failures (HTTP gating, etc.).
    if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
      try {
        navigator.clipboard?.writeText?.(v)?.catch(() => {
          /* ignore */
        });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const paste = useCallback((): string | null => clipboard, []);

  return {
    clipboard,
    copied: copiedAt != null,
    recents,
    copy,
    paste,
  };
}
