import { siteModule } from '../src/manifest';
import { coreModule, schema, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { sitePublishes } from '../src/schema';
import { countPublishes, getPublish, listPublishes, recordPublish } from '../src/services/publishes';

const manifest = () => JSON.stringify(Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`_astro/bilder/hund-${String(i).padStart(4, '0')}.webp`, 'a'.repeat(64)])));
const seeded = () => {
  const deps = createTestDeps({ manifests: [coreModule, siteModule] });
  insertUser(deps, { id: 'U1', name: 'Erika Beispiel' });
  for (let i = 1; i <= 20; i++) {
    deps.db
      .insert(sitePublishes)
      .values({
        id: `P${String(i).padStart(2, '0')}`,
        environment: deps.env,
        startedAt: `2026-10-01T08:${String(i).padStart(2, '0')}:00.000Z`,
        status: 'success',
        triggeredByUserId: 'U1',
        log: 'l'.repeat(20_000),
        fileManifest: manifest(),
      })
      .run();
  }
  return deps;
};
const view = ctxWith(['site.view']);

describe('listPublishes', () => {
  it('leaves out manifest and log and stays small', async () => {
    const deps = seeded();
    const list = unwrap(await listPublishes(deps, view, {}));
    expect(list).toHaveLength(20);
    expect(list[0]).not.toHaveProperty('fileManifest');
    expect(list[0]).not.toHaveProperty('log');
    expect(list[0]).toMatchObject({ triggeredByName: 'Erika Beispiel', hasLog: true });
    expect(JSON.stringify(list).length).toBeLessThan(10_000);
  });
  it('defaults to the own environment, needs site.view, validates', async () => {
    const deps = seeded();
    expect(unwrap(await listPublishes(deps, view, { environment: 'other' }))).toHaveLength(0);
    expect(await listPublishes(deps, ctxWith([]), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await listPublishes(deps, view, { limit: 0 })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

/** Keine stille Grenze (MUSTER § L): „Letzte Publishes“ zeigt 20 und nennt die Gesamtzahl. */
describe('countPublishes', () => {
  it('counts the own environment by default, another on request; needs site.view, validates', async () => {
    const deps = seeded();
    expect(unwrap(await countPublishes(deps, view, {}))).toBe(20);
    expect(unwrap(await countPublishes(deps, view, { environment: 'other' }))).toBe(0);
    expect(await countPublishes(deps, ctxWith([]), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await countPublishes(deps, view, { environment: '' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('getPublish', () => {
  it('trims files and log by default and gives everything on request', async () => {
    const deps = seeded();
    const short = unwrap(await getPublish(deps, view, { id: 'P01' }));
    expect(short.files).toMatchObject({ total: 2000, truncated: true });
    expect(short.files.items).toHaveLength(20);
    expect(short.log.text).toHaveLength(2000);
    expect(short).not.toHaveProperty('fileManifest');
    const full = unwrap(await getPublish(deps, view, { id: 'P01', paths: 'all', log: 'full' }));
    expect(full.files.items).toHaveLength(2000);
    expect(full.log.text).toHaveLength(20_000);
  });
  it('reports notFound, forbidden and validation', async () => {
    const deps = seeded();
    expect(await getPublish(deps, view, { id: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await getPublish(deps, ctxWith([]), { id: 'P01' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await getPublish(deps, view, { id: '' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('source of a publish', () => {
  const record = (deps: ReturnType<typeof createTestDeps>, ctx: ReturnType<typeof ctxWith>, at: string) =>
    recordPublish(deps, ctx, { environment: deps.env, startedAt: at, status: 'success', contentHash: 'h', diff: { changed: [], added: [], removed: [] }, fileManifest: {}, log: 'x', summary: 's' });
  it('reads channel and token name from the audit entry, in list and detail', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'U1', name: 'Erika Beispiel' });
    deps.db.insert(schema.apiTokens).values({ id: 'T1', userId: 'U1', name: 'Hundeblicke-Sync', prefix: 'dev_abc', tokenHash: 'x', createdAt: '2026-10-01T00:00:00.000Z' }).run();
    const ui = record(deps, ctxWith(['site.view'], 'U1'), '2026-10-01T08:00:00.000Z');
    const mcp = record(deps, { ...ctxWith(['site.view'], 'U1'), channel: 'mcp', apiTokenId: 'T1' }, '2026-10-01T09:00:00.000Z');
    const system = record(deps, { ...ctxWith([], 'U1'), channel: 'system' }, '2026-10-01T10:00:00.000Z');
    const list = unwrap(await listPublishes(deps, view, {}));
    const bySource = Object.fromEntries(list.map((r) => [r.id, r.source]));
    expect(bySource[ui.id]).toEqual({ channel: 'ui', tokenName: null });
    expect(bySource[mcp.id]).toEqual({ channel: 'mcp', tokenName: 'Hundeblicke-Sync' });
    expect(bySource[system.id]).toEqual({ channel: 'system', tokenName: null });
    expect(unwrap(await getPublish(deps, view, { id: mcp.id })).source).toEqual({ channel: 'mcp', tokenName: 'Hundeblicke-Sync' });
  });
  it('falls back to the interface for an entry without an audit row', async () => {
    const deps = seeded();
    expect(unwrap(await getPublish(deps, view, { id: 'P01' })).source).toEqual({ channel: 'ui', tokenName: null });
  });
});
