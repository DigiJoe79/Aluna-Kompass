import { ctxWith, insertUser } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DMS_DASHBOARD_TILES } from '../src/dashboard';
import { createDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { linkDocument } from '../src/service';
import { dmsModule } from '../src/manifest';
import { documents } from '../src/schema';
import { ALL_DMS, fileFixture, pdfBytes, setupWithTypes } from './helpers';

const tile = (key: string) => {
  const found = DMS_DASHBOARD_TILES.find((t) => t.key === key);
  if (!found) throw new Error(`keine Kachel ${key}`);
  return found;
};
const defaults = (key: string) => tile(key).options.parse({}) as Record<string, unknown>;

describe('dms tiles', () => {
  it('stehen am Manifest mit Form, Recht und Vorgabe', () => {
    expect(dmsModule.dashboardTiles?.map((t) => `${t.key}:${t.kind}:${t.permission}:${t.defaultOn}`)).toEqual([
      'inbox:list:dms.view:true',
      'drafts:count:dms.view:true',
      'unsent:count:dms.view:true',
      'textFailed:count:dms.manage:false',
    ]);
  });

  it('jede Kachel liefert die deklarierte Form, auch leer', async () => {
    const { deps, ctx } = setupWithTypes();
    for (const t of DMS_DASHBOARD_TILES) {
      const content = await t.load(deps, ctx, t.options.parse({}));
      expect(content.kind, t.key).toBe(t.kind);
    }
  });
});

describe('inbox tile', () => {
  it('zeigt die ältesten Eingänge ohne Ordner mit Datum, Absender und Betreff', async () => {
    const { deps, ctx } = setupWithTypes();
    const sender = await createContact(deps, ctx, { kind: 'organization', name: 'Finanzamt Musterstadt' });
    if (!sender.ok) throw new Error('contact');
    const newer = await receiveDocument(deps, ctx, { filename: 'b.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Neuer', documentDate: '2026-03-02', folder: null });
    const older = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Älter', documentDate: '2026-03-01', folder: null });
    await receiveDocument(deps, ctx, { filename: 'c.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Sortiert', documentDate: '2026-03-03', folder: 'behoerden' });
    if (!older.ok || !newer.ok) throw new Error('receive');
    await linkDocument(deps, ctx, { documentId: older.value.id, entityType: 'contact', entityId: sender.value.id, role: 'sender' });
    const content = await tile('inbox').load(deps, ctx, defaults('inbox'));
    expect(content.kind === 'list' && content.total).toBe(2);
    expect(content.kind === 'list' && content.lines.map((l) => [l.date, l.title, l.extra, l.href])).toEqual([
      ['2026-03-01', 'Älter', 'Finanzamt Musterstadt', `/dms/${older.value.id}`],
      ['2026-03-02', 'Neuer', undefined, `/dms/${newer.value.id}`],
    ]);
    expect(content.kind === 'list' && content.href).toBe('/dms?inbox=1');
  });

  it('liefert mit rows 0 nur die Zahl', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'A', documentDate: '2026-03-01', folder: null });
    const content = await tile('inbox').load(deps, ctx, { rows: 0 });
    expect(content).toEqual({ kind: 'list', lines: [], total: 1, href: '/dms?inbox=1' });
  });
});

describe('drafts tile', () => {
  it('zählt standardmäßig nur die eigenen, mit onlyMine=false alle', async () => {
    const { deps, ctx } = setupWithTypes();
    const other = ctxWith(ALL_DMS, insertUser(deps, { name: 'Andere', email: 'andere@kompass.local' }));
    await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Meiner', body: 'x' });
    await createDraft(deps, other, { typeKey: 'letter', subject: 'Fremder', body: 'x' });
    expect(await tile('drafts').load(deps, ctx, defaults('drafts'))).toEqual({ kind: 'count', count: 1, href: '/dms?phase=draft' });
    expect(await tile('drafts').load(deps, ctx, { onlyMine: false })).toEqual({ kind: 'count', count: 2, href: '/dms?phase=draft' });
  });
});

describe('unsent tile', () => {
  it('zählt festgeschriebene Ausgänge ohne Versandvermerk', async () => {
    const { deps, ctx } = setupWithTypes();
    await fileFixture(deps, ctx);
    expect(await tile('unsent').load(deps, ctx, {})).toEqual({ kind: 'count', count: 1, href: '/dms?unsent=1' });
  });
});

describe('textFailed tile', () => {
  it('zählt Dokumente mit fehlgeschlagener Texterkennung', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'A', documentDate: '2026-03-01', folder: null });
    if (!received.ok) throw new Error('receive');
    deps.db.update(documents).set({ textStatus: 'failed' }).where(eq(documents.id, received.value.id)).run();
    expect(await tile('textFailed').load(deps, ctx, {})).toEqual({ kind: 'count', count: 1, href: '/dms' });
  });
});
