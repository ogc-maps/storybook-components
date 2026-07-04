// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadBlob } from '../download';

// jsdom does not implement URL.createObjectURL / revokeObjectURL.
URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-url');
URL.revokeObjectURL = vi.fn();

describe('downloadBlob', () => {
  beforeEach(() => {
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:http://localhost/mock-url');
    vi.mocked(URL.revokeObjectURL).mockClear();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('creates an object URL from the provided blob', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    downloadBlob(blob, 'test.txt');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('sets href and download attribute on the anchor before clicking', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const blob = new Blob(['data'], { type: 'text/csv' });
    downloadBlob(blob, 'export.csv');
    const anchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.href).toBe('blob:http://localhost/mock-url');
    expect(anchor.download).toBe('export.csv');
    expect(anchor.style.display).toBe('none');
  });

  it('clicks the anchor to trigger the download', () => {
    const blob = new Blob([''], { type: 'application/json' });
    downloadBlob(blob, 'data.json');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it('removes the anchor from the document after clicking', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    const blob = new Blob(['x']);
    downloadBlob(blob, 'file.bin');
    expect(removeSpy).toHaveBeenCalledWith(appendSpy.mock.calls[0][0]);
  });

  it('revokes the object URL after clicking', () => {
    const blob = new Blob(['x']);
    downloadBlob(blob, 'file.bin');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-url');
  });
});
