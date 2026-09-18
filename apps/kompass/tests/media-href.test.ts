import { describe, expect, it } from 'vitest';
import { formatBytes, mediaHref } from '@/app/(shell)/admin/media/types';

describe('mediaHref', () => {
  it('writes only what differs from the default', () => {
    expect(mediaHref({ folder: null, q: '', kind: 'all', sort: 'newest' })).toBe('/admin/media');
    expect(mediaHref({ folder: 'Tiere/2026', q: 'rex', kind: 'image', sort: 'name' })).toBe('/admin/media?folder=Tiere%2F2026&q=rex&kind=image&sort=name');
  });
});

describe('formatBytes', () => {
  it('shows KB below a megabyte and MB with one decimal above', () => {
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(5 * 1024 * 1024 + 200 * 1024)).toBe('5,2 MB');
  });
});
