import { describe, expect, it } from 'vitest';
import { mediaFolders } from '../src/db/schema';
import { planFolderMove, withinSubtree } from '../src/media/folders';
import { createTestDeps } from '../src/testing';

const tree = ['a', 'a/b', 'a/b/c', 'a_b', 'axb', 'axb/k', 'x', 'x/y'];

describe('planFolderMove', () => {
  it('renames the whole subtree and nothing else', () => {
    expect(planFolderMove(tree, 'a', 'x/a')).toEqual({ ok: true, renames: [
      { from: 'a', to: 'x/a' }, { from: 'a/b', to: 'x/a/b' }, { from: 'a/b/c', to: 'x/a/b/c' },
    ] });
  });
  it('treats _ and % as plain characters', () => {
    expect(planFolderMove(tree, 'a_b', 'q')).toEqual({ ok: true, renames: [{ from: 'a_b', to: 'q' }] });
    const withPercent = [...tree, 'a%b', 'a%b/k'];
    expect(planFolderMove(withPercent, 'a%b', 'q')).toEqual({ ok: true, renames: [{ from: 'a%b', to: 'q' }, { from: 'a%b/k', to: 'q/k' }] });
    expect(planFolderMove(withPercent, 'a', 'q')).toMatchObject({ ok: true, renames: [{ from: 'a' }, { from: 'a/b' }, { from: 'a/b/c' }] });
  });
  it('refuses the same place, a target inside itself, an existing target', () => {
    expect(planFolderMove(tree, 'a', 'a')).toEqual({ ok: false, reason: 'sameLocation' });
    expect(planFolderMove(tree, 'a', 'a/b/a')).toEqual({ ok: false, reason: 'insideItself' });
    expect(planFolderMove(tree, 'a', 'x')).toEqual({ ok: false, reason: 'exists' });
    expect(planFolderMove(tree, 'nope', 'z')).toEqual({ ok: false, reason: 'notFound' });
  });
  it('allows a change of case only', () => {
    expect(planFolderMove(tree, 'axb', 'AxB').ok).toBe(true);
  });
  it('checks depth and length for every path of the subtree', () => {
    const deep = ['a', 'a/2', 'a/2/3', 'a/2/3/4', 'a/2/3/4/5', 'a/2/3/4/5/6', 'a/2/3/4/5/6/7', 'p', 'p/q'];
    expect(planFolderMove(deep, 'a', 'p/q/a')).toEqual({ ok: false, reason: 'tooDeep' });
    const long = ['a', `a/${'n'.repeat(60)}`, 'p'];
    expect(planFolderMove(long, 'a', `p/${'m'.repeat(60)}/${'o'.repeat(60)}/${'r'.repeat(20)}`)).toEqual({ ok: false, reason: 'tooLong' });
  });
});

describe('planFolderMove: Ziele im Teilbaum', () => {
  it('refuses when a renamed sub-path already exists (folder without parent)', () => {
    // `x/a/b` gibt es, `x/a` nicht: a → x/a würde a/b auf das vorhandene x/a/b legen.
    expect(planFolderMove(['a', 'a/b', 'x', 'x/a/b'], 'a', 'x/a')).toEqual({ ok: false, reason: 'exists' });
  });
});

describe('withinSubtree', () => {
  it('counts characters, not UTF-16 units (emoji, % and _)', () => {
    const deps = createTestDeps();
    const paths = ['🐶x', '🐶x/y', '🐶xy', 'a%b', 'a%b/k', 'a_b', 'axb/k'];
    deps.db.insert(mediaFolders).values(paths.map((path) => ({ path, createdAt: '2026-09-05T08:00:00.000Z' }))).run();
    const within = (root: string) => deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(withinSubtree(mediaFolders.path, root)).all().map((r) => r.path).sort();
    expect(within('🐶x')).toEqual(['🐶x', '🐶x/y']);
    expect(within('a%b')).toEqual(['a%b', 'a%b/k']);
    expect(within('a_b')).toEqual(['a_b']);
  });
});
