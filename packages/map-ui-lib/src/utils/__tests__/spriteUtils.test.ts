import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchSpriteUrlFromStyle,
  fetchSpriteNames,
  resolveStyleWithSprites,
  resolveAvailableIcons,
} from '../spriteUtils';

// restoreMocks:true in vitest config restores stubs after each test,
// so we must re-stub in beforeEach.
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

function okJson(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}
function notOk() {
  return Promise.resolve({ ok: false } as Response);
}

describe('fetchSpriteUrlFromStyle', () => {
  it('returns null when fetch fails with non-ok response', async () => {
    mockFetch.mockReturnValue(notOk());
    expect(await fetchSpriteUrlFromStyle('http://x')).toBeNull();
  });

  it('returns null when style has no sprite', async () => {
    mockFetch.mockReturnValue(okJson({}));
    expect(await fetchSpriteUrlFromStyle('http://x')).toBeNull();
  });

  it('returns the sprite string URL', async () => {
    mockFetch.mockReturnValue(okJson({ sprite: 'http://sprites/base' }));
    expect(await fetchSpriteUrlFromStyle('http://x')).toBe('http://sprites/base');
  });

  it('returns first url from sprite array', async () => {
    const sprite = [
      { id: 'default', url: 'http://sprites/default' },
      { id: 'maki', url: 'http://sprites/maki' },
    ];
    mockFetch.mockReturnValue(okJson({ sprite }));
    expect(await fetchSpriteUrlFromStyle('http://x')).toBe('http://sprites/default');
  });

  it('returns null on network error', async () => {
    mockFetch.mockImplementation(() => { throw new Error('network'); });
    expect(await fetchSpriteUrlFromStyle('http://x')).toBeNull();
  });
});

describe('fetchSpriteNames', () => {
  it('returns sorted icon names', async () => {
    mockFetch.mockReturnValue(okJson({ zoo: {}, airport: {}, bank: {} }));
    expect(await fetchSpriteNames('http://sprites/base')).toEqual(['airport', 'bank', 'zoo']);
  });

  it('returns empty array when fetch fails', async () => {
    mockFetch.mockReturnValue(notOk());
    expect(await fetchSpriteNames('http://sprites/base')).toEqual([]);
  });

  it('appends .json to sprite url', async () => {
    mockFetch.mockReturnValue(okJson({}));
    await fetchSpriteNames('http://sprites/base');
    expect(mockFetch).toHaveBeenCalledWith('http://sprites/base.json');
  });
});

describe('resolveStyleWithSprites', () => {
  it('throws when style fetch fails', async () => {
    mockFetch.mockReturnValue(notOk());
    await expect(resolveStyleWithSprites('http://style', [])).rejects.toThrow('Failed to fetch style');
  });

  it('returns style unchanged when no custom sprites', async () => {
    const style = { version: 8, sprite: 'http://base-sprite' };
    mockFetch.mockReturnValue(okJson(style));
    const result = await resolveStyleWithSprites('http://style', []);
    expect(result).toEqual(style);
  });

  it('merges custom sprites, promoting existing string sprite to array', async () => {
    const style = { version: 8, sprite: 'http://base-sprite' };
    mockFetch.mockReturnValue(okJson(style));
    const custom = [{ id: 'custom', url: 'http://custom-sprite' }];
    const result = await resolveStyleWithSprites('http://style', custom);
    expect(result.sprite).toEqual([
      { id: 'default', url: 'http://base-sprite' },
      { id: 'custom', url: 'http://custom-sprite' },
    ]);
  });

  it('overrides existing sprite with same id', async () => {
    const style = { version: 8, sprite: [{ id: 'maki', url: 'http://old' }] };
    mockFetch.mockReturnValue(okJson(style));
    const custom = [{ id: 'maki', url: 'http://new' }];
    const result = await resolveStyleWithSprites('http://style', custom);
    const sprites = result.sprite as Array<{ id: string; url: string }>;
    const maki = sprites.filter((s) => s.id === 'maki');
    expect(maki).toHaveLength(1);
    expect(maki[0].url).toBe('http://new');
  });
});

describe('resolveAvailableIcons', () => {
  it('returns empty array when no args provided', async () => {
    expect(await resolveAvailableIcons()).toEqual([]);
  });

  it('prefixes icons from non-default sprites', async () => {
    // Use URL-based routing because basemap and custom sprite fetches run concurrently.
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://style') return okJson({ sprite: [{ id: 'maki', url: 'http://maki' }] });
      if (url === 'http://maki.json') return okJson({ bank: {}, park: {} });
      return notOk();
    });

    const icons = await resolveAvailableIcons('http://style');
    expect(icons).toEqual(['maki:bank', 'maki:park']);
  });

  it('returns bare names for default sprite', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://style') return okJson({ sprite: [{ id: 'default', url: 'http://default' }] });
      if (url === 'http://default.json') return okJson({ dot: {}, circle: {} });
      return notOk();
    });

    const icons = await resolveAvailableIcons('http://style');
    expect(icons).toEqual(['circle', 'dot']);
  });

  it('merges basemap and custom sprite icons, deduplicating', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://style') return okJson({ sprite: [{ id: 'default', url: 'http://base' }] });
      if (url === 'http://base.json') return okJson({ dot: {}, circle: {} });
      if (url === 'http://custom.json') return okJson({ dot: {}, star: {} });
      return notOk();
    });

    const icons = await resolveAvailableIcons('http://style', [{ id: 'custom', url: 'http://custom' }]);
    expect(icons).toContain('dot');
    expect(icons).toContain('circle');
    expect(icons).toContain('custom:dot');
    expect(icons).toContain('custom:star');
    // deduplication: bare 'dot' and 'custom:dot' are distinct (different namespaces)
    expect(icons.filter((i) => i === 'dot')).toHaveLength(1);
  });
});
