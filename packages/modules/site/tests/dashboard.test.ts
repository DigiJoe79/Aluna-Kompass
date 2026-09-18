import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { writeSettingInternal, systemContext } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { SITE_DASHBOARD_TILES } from '../src/dashboard';
import { siteModule } from '../src/manifest';
import { siteEntries, sitePublishes, siteTemplateState, siteValues } from '../src/schema';

const tile = SITE_DASHBOARD_TILES[0]!;
const ctx = ctxWith(['site.view'], 'U');

function setup() {
  const deps = createTestDeps({ locales: ['de'], now: '2026-09-17T08:00:00.000Z' });
  deps.db
    .insert(siteTemplateState)
    .values({ id: 'current', name: 'T', schemaJson: { name: 'T', locales: ['de'], uses: [], variables: {}, collections: {} }, checksum: 'a'.repeat(64), readAt: '2026-09-01T00:00:00.000Z', readByUserId: null })
    .run();
  return deps;
}

const publish = (deps: ReturnType<typeof setup>, startedAt: string, status: 'success' | 'failed') =>
  deps.db.insert(sitePublishes).values({ id: `P-${startedAt}-${status}`, environment: deps.env, startedAt, finishedAt: startedAt, status, contentHash: '', log: '', fileManifest: '{}' }).run();

describe('site tile', () => {
  it('steht am Manifest als status-Kachel mit site.view', () => {
    expect(siteModule.dashboardTiles?.map((t) => `${t.key}:${t.kind}:${t.permission}:${t.defaultOn}`)).toEqual(['site:status:site.view:true']);
    expect(tile.messageKeys).toEqual(['templateUnreviewed', 'lastFailed', 'changed', 'never', 'current']);
  });

  it('meldet „nie publiziert“ ohne erfolgreichen Publish', async () => {
    const deps = setup();
    expect(await tile.load(deps, ctx, {})).toEqual({ kind: 'status', tone: 'info', messageKey: 'never', href: '/site/publish' });
  });

  it('meldet den Stand, wenn seit dem letzten Publish nichts geändert wurde', async () => {
    const deps = setup();
    publish(deps, '2026-09-10T10:00:00.000Z', 'success');
    deps.db.insert(siteEntries).values({ id: 'E1', collection: 'news', slug: 'a', sortOrder: 0, isPublished: true, data: {}, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }).run();
    expect(await tile.load(deps, ctx, {})).toEqual({ kind: 'status', tone: 'neutral', messageKey: 'current', values: { date: '2026-09-10T10:00:00.000Z' }, href: '/site/publish' });
  });

  it('zählt Einträge und Variablen, die jünger sind als der letzte erfolgreiche Publish', async () => {
    const deps = setup();
    publish(deps, '2026-09-10T10:00:00.000Z', 'success');
    deps.db.insert(siteEntries).values({ id: 'E1', collection: 'news', slug: 'a', sortOrder: 0, isPublished: true, data: {}, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' }).run();
    deps.db.insert(siteEntries).values({ id: 'E2', collection: 'news', slug: 'b', sortOrder: 1, isPublished: true, data: {}, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }).run();
    deps.db.insert(siteValues).values({ key: 'title', value: 'x', updatedAt: '2026-09-11T00:00:00.000Z' }).run();
    expect(await tile.load(deps, ctx, {})).toEqual({ kind: 'status', tone: 'info', messageKey: 'changed', values: { count: 2 }, href: '/site/publish' });
  });

  it('warnt, wenn der letzte Publish fehlgeschlagen ist, auch bei älterem Erfolg', async () => {
    const deps = setup();
    publish(deps, '2026-09-10T10:00:00.000Z', 'success');
    publish(deps, '2026-09-12T10:00:00.000Z', 'failed');
    expect(await tile.load(deps, ctx, {})).toEqual({ kind: 'status', tone: 'warning', messageKey: 'lastFailed', href: '/site/publish' });
  });

  it('warnt zuerst vor einem ungeprüften Template nach einem Import', async () => {
    const deps = setup();
    publish(deps, '2026-09-12T10:00:00.000Z', 'failed');
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'system.lastImportAt', '2026-09-15T00:00:00.000Z', 'test'));
    expect(await tile.load(deps, ctx, {})).toEqual({ kind: 'status', tone: 'warning', messageKey: 'templateUnreviewed', href: '/site/publish' });
  });
});
