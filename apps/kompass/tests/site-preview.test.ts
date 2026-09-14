import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePreviewFile, rewritePreviewHtml } from '@/lib/site-preview';

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

describe('rewritePreviewHtml', () => {
  it('bends absolute paths onto the preview directory', () => {
    expect(rewritePreviewHtml('<head><link href="/style.css">')).toContain('href="/site/preview/style.css"');
    expect(rewritePreviewHtml('<img src="/images/a.webp">')).toContain('src="/site/preview/images/a.webp"');
    expect(rewritePreviewHtml('<head>')).toContain('<base href="/site/preview/">');
  });

  it('bends every address of a srcset, not just the first', () => {
    const html = '<img srcset="/images/a-480.webp 480w, /images/a-960.webp 960w, /images/a-1600.webp 1600w">';
    expect(rewritePreviewHtml(html)).toBe(
      '<img srcset="/site/preview/images/a-480.webp 480w, /site/preview/images/a-960.webp 960w, /site/preview/images/a-1600.webp 1600w">',
    );
  });

  /**
   * Was schon woanders hinzeigt, bleibt unangetastet — sonst führte die
   * Vorschau eine fremde Adresse ins Leere.
   */
  it('leaves addresses alone that do not start at the root', () => {
    expect(rewritePreviewHtml('<img srcset="https://cdn.example.org/a.webp 480w">')).toContain('"https://cdn.example.org/a.webp 480w"');
    expect(rewritePreviewHtml('<img srcset="//example.org/a.webp 480w">')).toContain('"//example.org/a.webp 480w"');
    expect(rewritePreviewHtml('<img src="//example.org/a.webp">')).toContain('src="//example.org/a.webp"');
    expect(rewritePreviewHtml('<a href="aktuelles/">')).toContain('href="aktuelles/"');
  });
});
