import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePreviewFile } from '@/lib/site-preview';

describe('resolvePreviewFile', () => {
  const root = path.resolve('/cache/site-preview');

  it('maps url segments onto the preview directory', () => {
    expect(resolvePreviewFile(root, ['aktuelles', 'fest', 'index.html'])).toBe(path.join(root, 'aktuelles', 'fest', 'index.html'));
    expect(resolvePreviewFile(root, [])).toBe(root);
  });

  it('refuses to leave the directory, even into a sibling that shares the prefix', () => {
    expect(resolvePreviewFile(root, ['..', 'site-preview-alt', 'index.html'])).toBeNull();
    expect(resolvePreviewFile(root, ['..', '..', 'etc', 'passwd'])).toBeNull();
  });
});
