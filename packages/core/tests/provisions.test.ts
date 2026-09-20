import { describe, expect, it } from 'vitest';
import { isProvisioned, provisionOnce } from '../src/modules/provisions';
import { moduleProvisions } from '../src/db/schema';
import { createTestDeps } from '../src/testing';

const KEY = { module: 'demo', kind: 'role', key: 'demo:clerk' };

describe('provisionOnce', () => {
  it('runs the creator once and remembers the outcome', () => {
    const deps = createTestDeps();
    let calls = 0;
    const first = deps.db.transaction((tx) => provisionOnce(tx, deps, KEY, () => { calls += 1; return 'created'; }));
    const second = deps.db.transaction((tx) => provisionOnce(tx, deps, KEY, () => { calls += 1; return 'created'; }));
    expect([first, second, calls]).toEqual(['created', 'already', 1]);
    expect(isProvisioned(deps.db, KEY)).toBe(true);
  });

  it('counts a skipped delivery as delivered — it never comes back', () => {
    const deps = createTestDeps();
    deps.db.transaction((tx) => provisionOnce(tx, deps, KEY, () => 'skipped'));
    const again = deps.db.transaction((tx) => provisionOnce(tx, deps, KEY, () => 'created'));
    expect(again).toBe('already');
    expect(deps.db.select().from(moduleProvisions).all()[0]!.outcome).toBe('skipped');
  });

  it('forgets nothing when the creator throws', () => {
    const deps = createTestDeps();
    expect(() => deps.db.transaction((tx) => provisionOnce(tx, deps, KEY, () => { throw new Error('boom'); }))).toThrow('boom');
    expect(isProvisioned(deps.db, KEY)).toBe(false);
  });
});
