import { describe, expect, it } from 'vitest';
import { formatBytes, mediaHref } from '@/app/(shell)/admin/media/types';

describe('mediaHref', () => {
  it('writes only what differs from the default', () => {
    expect(mediaHref({ folder: null, unfiled: false, q: '', kind: 'all', sort: 'newest' })).toBe('/admin/media');
    expect(mediaHref({ folder: 'Tiere/2026', unfiled: false, q: 'rex', kind: 'image', sort: 'name' })).toBe('/admin/media?folder=Tiere%2F2026&q=rex&kind=image&sort=name');
  });

  it('„Ohne Ordner“ is its own place and wins over a folder', () => {
    expect(mediaHref({ folder: null, unfiled: true, q: '', kind: 'all', sort: 'newest' })).toBe('/admin/media?unfiled=1');
    expect(mediaHref({ folder: 'Bilder', unfiled: true, q: 'x', kind: 'all', sort: 'newest' })).toBe('/admin/media?unfiled=1&q=x');
  });
});

describe('formatBytes', () => {
  it('shows KB below a megabyte and MB with one decimal above', () => {
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(5 * 1024 * 1024 + 200 * 1024)).toBe('5,2 MB');
  });
});
