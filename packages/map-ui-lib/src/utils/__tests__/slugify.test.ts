import { describe, it, expect } from 'vitest';
import { slugify } from '../slugify';

describe('slugify', () => {
  it('lowercases text', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('hello world')).toBe('hello-world');
  });

  it('collapses consecutive non-alphanumeric chars into a single hyphen', () => {
    expect(slugify('a  b')).toBe('a-b');
    expect(slugify('a--b')).toBe('a-b');
    expect(slugify('a!@#b')).toBe('a-b');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify(' hello ')).toBe('hello');
    expect(slugify('-hello-')).toBe('hello');
    expect(slugify('!hello!')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles string of only special characters', () => {
    expect(slugify('!@#$')).toBe('');
  });

  it('preserves digits', () => {
    expect(slugify('layer 1')).toBe('layer-1');
    expect(slugify('v2.0')).toBe('v2-0');
  });

  it('handles already-valid slug unchanged', () => {
    expect(slugify('my-layer')).toBe('my-layer');
  });
});
