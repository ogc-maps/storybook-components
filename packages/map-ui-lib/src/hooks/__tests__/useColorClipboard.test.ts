import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushRecentColor,
  _resetColorClipboardForTests,
  _getRecentColorsForTests,
} from '../useColorClipboard';

describe('pushRecentColor', () => {
  beforeEach(() => {
    _resetColorClipboardForTests();
  });

  it('dedupes and reorders most-recent first', () => {
    pushRecentColor('#ff0000');
    pushRecentColor('#00ff00');
    pushRecentColor('#0000ff');
    pushRecentColor('#ff0000'); // dedupe -> moves to front
    expect(_getRecentColorsForTests()[0]).toBe('#ff0000');
    expect(_getRecentColorsForTests()).toHaveLength(3);

    // Push 10 unique colors to exercise the 8-item cap.
    // Expected final list (MRU order, capped at 8):
    //   [#000009, #000008, #000007, #000006, #000005, #000004, #000003, #000002]
    for (let i = 0; i < 10; i++) {
      pushRecentColor(`#${i.toString(16).padStart(6, '0')}`);
    }

    const recents = _getRecentColorsForTests();
    expect(recents).toHaveLength(8);
    expect(recents[0]).toBe('#000009'); // most recent
    expect(recents[7]).toBe('#000002'); // oldest surviving (#000000 and #000001 evicted)
  });

  it('rejects non-hex strings silently', () => {
    expect(() => pushRecentColor('not-a-color')).not.toThrow();
    expect(() => pushRecentColor('')).not.toThrow();
    expect(() => pushRecentColor('rgb(1,2,3)')).not.toThrow();
  });

  it('accepts 3, 6, and 8 digit hex', () => {
    expect(() => pushRecentColor('#fff')).not.toThrow();
    expect(() => pushRecentColor('#ffffff')).not.toThrow();
    expect(() => pushRecentColor('#ffffffff')).not.toThrow();
  });
});
