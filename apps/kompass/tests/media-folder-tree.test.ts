import { describe, expect, it } from 'vitest';
import { flattenFolderTree } from '@/app/(shell)/admin/media/folder-tree-model';

/**
 * Der Ordnerbaum kam als Liste, sortiert nach dem rohen Pfad. Seit Ordnernamen
 * Leerzeichen und Großbuchstaben dürfen, stand das Kind `a/b` hinter den
 * Geschwistern `a b` und `a-x`, und `Tiere` vor `bilder` — die Einrückung
 * zeigte dann auf die falschen Eltern.
 */
describe('flattenFolderTree', () => {
  const folders = ['Tiere', 'bilder', 'a', 'a b', 'a/b', 'a-x', 'a/b/c'].map((path) => ({ path, assetCount: 0 }));

  it('keeps children right under their parent and sorts siblings by name, case-insensitively', () => {
    expect(flattenFolderTree(folders).map((n) => n.path)).toEqual(['a', 'a/b', 'a/b/c', 'a b', 'a-x', 'bilder', 'Tiere']);
  });

  it('reports the depth and the last segment of every node', () => {
    const nodes = flattenFolderTree(folders);
    expect(nodes.find((n) => n.path === 'a/b/c')).toMatchObject({ name: 'c', depth: 2, assetCount: 0 });
    expect(nodes.find((n) => n.path === 'Tiere')).toMatchObject({ name: 'Tiere', depth: 0 });
  });

  it('shows a folder whose parent row is missing at the depth of its path', () => {
    const nodes = flattenFolderTree([{ path: 'x/y', assetCount: 2 }]);
    expect(nodes).toEqual([{ path: 'x/y', name: 'y', depth: 1, assetCount: 2 }]);
  });
});
