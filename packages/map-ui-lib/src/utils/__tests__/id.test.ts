import { describe, it, expect } from 'vitest';
import { generateId } from '../id';

describe('generateId', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('returns a valid UUID v4', () => {
    expect(generateId()).toMatch(UUID_RE);
  });

  it('returns unique values across many calls', () => {
    const ids = Array.from({ length: 100 }, generateId);
    expect(new Set(ids).size).toBe(100);
  });

  it('fallback path produces a valid UUID v4 when randomUUID is absent', () => {
    const original = crypto.randomUUID;
    // @ts-expect-error intentionally removing native API to test fallback
    crypto.randomUUID = undefined;
    try {
      expect(generateId()).toMatch(UUID_RE);
    } finally {
      crypto.randomUUID = original;
    }
  });

  it('fallback sets version nibble to 4', () => {
    const original = crypto.randomUUID;
    // @ts-expect-error
    crypto.randomUUID = undefined;
    try {
      const id = generateId();
      expect(id[14]).toBe('4');
    } finally {
      crypto.randomUUID = original;
    }
  });

  it('fallback sets variant bits correctly (8, 9, a, or b)', () => {
    const original = crypto.randomUUID;
    // @ts-expect-error
    crypto.randomUUID = undefined;
    try {
      const id = generateId();
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
    } finally {
      crypto.randomUUID = original;
    }
  });
});
