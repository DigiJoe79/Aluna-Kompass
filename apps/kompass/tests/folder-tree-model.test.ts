import { describe, expect, it } from 'vitest';
import {
  TREE_ROOT,
  ancestorsOf,
  applyFolderChange,
  buildFolderTree,
  deleteBlock,
  followFolder,
  isWithin,
  nameOf,
  namesBelow,
  renamePrefixPaths,
  resolveExpanded,
  validateFolderName,
  validateFolderPlacement,
  validateFolderTarget,
  type DragItem,
} from '@/lib/folder-tree-model';

const entries = (paths: string[], count = 0) => paths.map((path) => ({ path, count }));

describe('buildFolderTree', () => {
  it('adds missing parents with no documents of their own and marks them as not created', () => {
    const tree = buildFolderTree(entries(['a/b/c'], 1));
    expect(Object.keys(tree).sort()).toEqual([TREE_ROOT, 'a', 'a/b', 'a/b/c'].sort());
    expect(tree['a']).toMatchObject({ path: 'a', name: 'a', parent: TREE_ROOT, children: ['a/b'], direct: 0, depth: 0, created: false });
    expect(tree['a/b']).toMatchObject({ name: 'b', parent: 'a', children: ['a/b/c'], direct: 0, depth: 1, created: false });
    expect(tree['a/b/c']).toMatchObject({ name: 'c', parent: 'a/b', children: [], direct: 1, depth: 2, created: true });
    expect(tree[TREE_ROOT]?.children).toEqual(['a']);
  });

  it('marks every path present in the entries as created, even when a child came first', () => {
    const tree = buildFolderTree([{ path: 'a/b', count: 0 }, { path: 'a', count: 0 }]);
    expect(tree['a']?.created).toBe(true);
    expect(tree['a/b']?.created).toBe(true);
  });

  it('sums the documents of a whole subtree into its total', () => {
    const tree = buildFolderTree([
      { path: 'a', count: 3 },
      { path: 'a/b', count: 2 },
      { path: 'a/b/c', count: 4 },
    ]);
    expect([tree['a']?.total, tree['a/b']?.total, tree['a/b/c']?.total]).toEqual([9, 6, 4]);
    expect([tree['a']?.direct, tree['a/b']?.direct, tree['a/b/c']?.direct]).toEqual([3, 2, 4]);
    expect(tree[TREE_ROOT]?.total).toBe(9);
  });

  it('sorts siblings by name in German alphabetical order and keeps a/b under a', () => {
    const tree = buildFolderTree(entries(['Verträge', 'ämter', 'Behörden', 'a b', 'a/b']));
    expect(tree[TREE_ROOT]?.children).toEqual(['a', 'a b', 'ämter', 'Behörden', 'Verträge']);
    expect(tree['a']?.children).toEqual(['a/b']);
  });

  it('orders names that differ only in case deterministically', () => {
    const one = buildFolderTree(entries(['b', 'B']))[TREE_ROOT]?.children;
    const two = buildFolderTree(entries(['B', 'b']))[TREE_ROOT]?.children;
    expect(one).toEqual(two);
  });
});

describe('ancestorsOf', () => {
  it('lists every parent path from the top, without the path itself', () => {
    expect(ancestorsOf('a/b/c')).toEqual(['a', 'a/b']);
    expect(ancestorsOf('a')).toEqual([]);
    expect(ancestorsOf('')).toEqual([]);
  });
});

describe('isWithin', () => {
  it('matches the folder itself and its subtree, but not a sibling with the same prefix', () => {
    expect(isWithin('a', 'a')).toBe(true);
    expect(isWithin('a/b', 'a')).toBe(true);
    expect(isWithin('a_b', 'a')).toBe(false);
    expect(isWithin('ab', 'a')).toBe(false);
    expect(isWithin('a', 'a/b')).toBe(false);
  });

  it('treats everything as within the tree root', () => {
    expect(isWithin('a/b', TREE_ROOT)).toBe(true);
  });
});

describe('nameOf', () => {
  it('returns the last segment', () => {
    expect(nameOf('a/b/c')).toBe('c');
    expect(nameOf('a b')).toBe('a b');
  });
});

describe('resolveExpanded (Spec § 5.2)', () => {
  const existing = new Set(Object.keys(buildFolderTree(entries(['a/b/c', 'd/e']))));

  it('drops stored paths that no longer exist, without failing (Review Focus 3)', () => {
    expect(resolveExpanded(['a', 'weg/geloescht', 'd'], existing, null)).toEqual(['a', 'd']);
  });

  it('always opens the path to the selected folder, once', () => {
    expect(resolveExpanded(['a'], existing, 'a/b/c')).toEqual(['a', 'a/b']);
    expect(resolveExpanded([], existing, 'd/e')).toEqual(['d']);
  });

  it('opens only the existing part of a path that is gone', () => {
    expect(resolveExpanded([], existing, 'a/x/y')).toEqual(['a']);
  });
});

describe('applyFolderChange (optimistischer Stand, Plan 3)', () => {
  const folders = [
    { path: 'a', count: 1 },
    { path: 'a/b', count: 2 },
    { path: 'a_b', count: 4 },
    { path: 'c', count: 8 },
  ];

  it('moves a folder with its subtree, segment by segment, and the counts travel along', () => {
    const next = applyFolderChange(folders, { kind: 'move', from: 'a', to: 'c/a' });
    expect(next).toEqual([
      { path: 'c/a', count: 1 },
      { path: 'c/a/b', count: 2 },
      { path: 'a_b', count: 4 },
      { path: 'c', count: 8 },
    ]);
    expect(buildFolderTree(next)['c']!.total).toBe(11);
  });

  it('removes a deleted folder and adds a created one with nothing in it', () => {
    expect(applyFolderChange(folders, { kind: 'delete', path: 'a_b' }).map((f) => f.path)).toEqual(['a', 'a/b', 'c']);
    expect(applyFolderChange(folders, { kind: 'create', path: 'c/neu' })).toContainEqual({ path: 'c/neu', count: 0 });
  });

  it('does not add a folder twice', () => {
    expect(applyFolderChange(folders, { kind: 'create', path: 'c' })).toHaveLength(4);
  });
});

describe('followFolder', () => {
  it('follows the selected folder when it or one of its ancestors moves', () => {
    expect(followFolder('a', 'a', 'c/a')).toBe('c/a');
    expect(followFolder('a/b', 'a', 'x')).toBe('x/b');
  });

  it('leaves everything else alone', () => {
    expect(followFolder('a_b', 'a', 'x')).toBe('a_b');
    expect(followFolder(null, 'a', 'x')).toBeNull();
  });
});

describe('renamePrefixPaths', () => {
  it('rewrites a folder and everything below it, segment by segment', () => {
    expect(renamePrefixPaths(['a', 'a/b', 'a_b', 'ab', 'c'], 'a', 'x/a')).toEqual(['x/a', 'x/a/b', 'a_b', 'ab', 'c']);
  });
});

describe('validateFolderTarget (Plan 1: planFolderMove)', () => {
  const nodes = buildFolderTree(entries(['a', 'a/b', 'a/b/c', 'a_b', 'x', 'x/b', 'y', 'tief/1/2/3/4/5/6', 'lang', 'g/h']));
  const folder = (path: string): DragItem => ({ kind: 'folder', path, total: 0 });
  const docs = (sources: (string | null)[]): DragItem => ({ kind: 'documents', ids: sources.map((_, i) => `d${i}`), sources, label: 'x' });

  it('accepts a folder in a foreign folder and on the top level', () => {
    expect(validateFolderTarget(nodes, folder('a/b'), 'y')).toBeNull();
    expect(validateFolderTarget(nodes, folder('a/b'), null)).toBeNull();
  });

  it('blocks the current parent as „here“, the top level included', () => {
    expect(validateFolderTarget(nodes, folder('a/b'), 'a')).toBe('here');
    expect(validateFolderTarget(nodes, folder('a'), null)).toBe('here');
  });

  it('blocks the folder itself and its subtree as „self“, segment by segment', () => {
    expect(validateFolderTarget(nodes, folder('a'), 'a')).toBe('self');
    expect(validateFolderTarget(nodes, folder('a'), 'a/b/c')).toBe('self');
    expect(validateFolderTarget(nodes, folder('a'), 'a_b')).toBeNull();
  });

  it('blocks a target that already has a folder of the same name', () => {
    expect(validateFolderTarget(nodes, folder('a/b'), 'x')).toBe('exists');
  });

  it('blocks a move that would put any folder of the subtree deeper than 8 levels', () => {
    // a/b/c landet als tief/1/2/3/4/5/6/b/c — 9 Ebenen.
    expect(validateFolderTarget(nodes, folder('a/b'), 'tief/1/2/3/4/5/6')).toBe('depth');
    expect(validateFolderTarget(nodes, folder('y'), 'tief/1/2/3/4/5/6')).toBeNull();
  });

  it('blocks a move that would make any path of the subtree longer than 200 characters', () => {
    const long = buildFolderTree(entries([`${'l'.repeat(150)}`, 'k', `k/${'m'.repeat(48)}`]));
    expect(validateFolderTarget(long, folder('k'), 'l'.repeat(150))).toBe('nameLength');
    expect(validateFolderTarget(long, folder(`k/${'m'.repeat(48)}`), 'l'.repeat(150))).toBeNull();
  });

  it('blocks folders without the right to manage them and content without the right to drop it', () => {
    expect(validateFolderTarget(nodes, folder('a/b'), 'y', { canManage: false, canDrop: true })).toBe('forbidden');
    expect(validateFolderTarget(nodes, docs(['a']), 'y', { canManage: true, canDrop: false })).toBe('forbidden');
    expect(validateFolderTarget(nodes, { kind: 'files', count: 1 }, 'y', { canManage: true, canDrop: false })).toBe('forbidden');
    expect(validateFolderTarget(nodes, docs(['a']), 'y', { canManage: false, canDrop: true })).toBeNull();
  });

  it('blocks a folder that exists only as a path for every kind of drop', () => {
    expect(nodes['g']?.created).toBe(false);
    expect(validateFolderTarget(nodes, folder('y'), 'g')).toBe('notCreated');
    expect(validateFolderTarget(nodes, docs(['a']), 'g')).toBe('notCreated');
    expect(validateFolderTarget(nodes, { kind: 'files', count: null }, 'g')).toBe('notCreated');
  });

  it('blocks documents only when all of them already lie in the target', () => {
    expect(validateFolderTarget(nodes, docs(['a', 'a']), 'a')).toBe('here');
    expect(validateFolderTarget(nodes, docs([null]), null)).toBe('here');
    expect(validateFolderTarget(nodes, docs(['a', 'x']), 'a')).toBeNull();
    expect(validateFolderTarget(nodes, docs([null, 'a']), null)).toBeNull();
  });

  it('accepts documents of unknown origin (dragged from elsewhere) and files', () => {
    expect(validateFolderTarget(nodes, { kind: 'documents', ids: [], sources: [], label: '' }, 'a')).toBeNull();
    expect(validateFolderTarget(nodes, { kind: 'files', count: 2 }, 'a')).toBeNull();
  });
});

describe('validateFolderName', () => {
  const siblings = ['Amtsgericht', 'Finanzamt'];

  it('accepts a new name and answers empty for nothing', () => {
    expect(validateFolderName(siblings, 'Archiv')).toBeNull();
    expect(validateFolderName(siblings, '')).toBe('empty');
  });

  it('refuses a slash, and more than 60 characters', () => {
    expect(validateFolderName(siblings, 'a/b')).toBe('slash');
    expect(validateFolderName(siblings, 'x'.repeat(60))).toBeNull();
    expect(validateFolderName(siblings, 'x'.repeat(61))).toBe('tooLong');
  });

  it('refuses what the server refuses besides the slash: backslash, control characters, dot segments, edge spaces', () => {
    expect(validateFolderName(siblings, 'a\\b')).toBe('invalid');
    expect(validateFolderName(siblings, 'a\u0007b')).toBe('invalid');
    expect(validateFolderName(siblings, '.')).toBe('invalid');
    expect(validateFolderName(siblings, '..')).toBe('invalid');
    expect(validateFolderName(siblings, ' a')).toBe('invalid');
    expect(validateFolderName(siblings, '...')).toBeNull();
  });

  it('refuses the name of a sibling, exactly compared', () => {
    expect(validateFolderName(siblings, 'Finanzamt')).toBe('exists');
    expect(validateFolderName(siblings, 'finanzamt')).toBeNull();
  });

  it('lets a folder keep its own name when renaming, and change only its case', () => {
    expect(validateFolderName(siblings, 'Finanzamt', 'Finanzamt')).toBeNull();
    expect(validateFolderName(siblings, 'FINANZAMT', 'Finanzamt')).toBeNull();
    expect(validateFolderName(siblings, 'Amtsgericht', 'Finanzamt')).toBe('exists');
  });
});

describe('validateFolderPlacement', () => {
  it('refuses a new folder below the eighth level', () => {
    const deep = Array.from({ length: 7 }, (_, i) => `e${i}`).join('/');
    const nodes = buildFolderTree(entries([deep]));
    expect(validateFolderPlacement(nodes, deep, 'neu')).toBeNull();
    expect(validateFolderPlacement(nodes, `${deep}/x`, 'neu')).toBe('depth');
  });

  it('refuses a path over 200 characters, for renaming across the whole subtree', () => {
    const nodes = buildFolderTree(entries(['a', `a/${'b'.repeat(60)}/${'c'.repeat(60)}/${'d'.repeat(60)}`]));
    expect(validateFolderPlacement(nodes, null, 'x'.repeat(60))).toBeNull();
    expect(validateFolderPlacement(nodes, null, 'x'.repeat(60), 'a')).toBe('nameLength');
    expect(validateFolderPlacement(nodes, null, 'x'.repeat(10), 'a')).toBeNull();
  });
});

describe('deleteBlock', () => {
  const nodes = buildFolderTree([
    { path: 'a', count: 3 },
    { path: 'a/b', count: 0 },
    { path: 'c', count: 0 },
    { path: 'c/d', count: 0 },
    { path: 'c/e', count: 0 },
    { path: 'f', count: 0 },
  ]);

  it('blocks a folder with documents of its own and names how many', () => {
    expect(deleteBlock(nodes['a']!)).toEqual({ reason: 'hasItems', count: 3 });
  });

  it('blocks a folder with subfolders, even empty ones (Handoff § 8.3)', () => {
    expect(deleteBlock(nodes['c']!)).toEqual({ reason: 'hasChildren', count: 2 });
  });

  it('lets an empty folder without subfolders go', () => {
    expect(deleteBlock(nodes['f']!)).toBeNull();
    expect(deleteBlock(nodes['a/b']!)).toBeNull();
  });
});

describe('namesBelow', () => {
  it('nennt den Ort unter dem geöffneten Ordner als Namen', () => {
    expect(namesBelow('behoerden/amtsgericht/vereinsregister-2026', 'behoerden')).toEqual(['amtsgericht', 'vereinsregister-2026']);
  });
  it('ist leer, wenn das Dokument direkt im geöffneten Ordner liegt', () => {
    expect(namesBelow('behoerden', 'behoerden')).toEqual([]);
  });
  it('nennt ohne geöffneten Ordner den ganzen Weg', () => {
    expect(namesBelow('behoerden/finanzamt', null)).toEqual(['behoerden', 'finanzamt']);
  });
  it('nennt einen Nachbarn mit gleichem Anfang ganz, nicht als Unterordner', () => {
    expect(namesBelow('behoerden_alt/x', 'behoerden')).toEqual(['behoerden_alt', 'x']);
  });
});
