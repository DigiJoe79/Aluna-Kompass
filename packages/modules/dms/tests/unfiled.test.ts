import { schema, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDocumentFolder, listDocumentFolders } from '../src/catalog';
import { documents } from '../src/schema';
import { listDocuments, moveDocument } from '../src/service';
import { setupWithTypes } from './helpers';

/**
 * Stufe 1, Auftrag 7: „Ohne Ordner“ — ausgehende Dokumente ohne Ordner waren im Baum unsichtbar. Der Eingangskorb
 * bleibt eingehend ∧ ohne Ordner; „Ohne Ordner“ ist ausgehend ∧ ohne Ordner. Zusammen mit den Ordnern ergeben beide
 * „Alle Dokumente“ — auch mit Entwürfen und stornierten.
 */
type Setup = ReturnType<typeof setupWithTypes>;

function insert({ deps, userId }: Setup, id: string, values: { direction: 'incoming' | 'outgoing'; folder: string | null; phase?: 'draft' | 'issued'; status?: 'issued' | 'voided' }) {
  deps.db
    .insert(documents)
    .values({
      id,
      phase: values.phase ?? 'issued',
      direction: values.direction,
      sourceKind: values.direction === 'incoming' ? 'uploaded' : 'generated',
      typeKey: values.direction === 'incoming' ? 'authority' : 'letter',
      number: values.phase === 'draft' ? null : `X-2026-${id}`,
      subject: `Dokument ${id}`,
      documentDate: '2026-09-10',
      fileName: `${id}.pdf`,
      status: values.status ?? 'issued',
      folder: values.folder,
      createdByUserId: userId,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    })
    .run();
}

async function world() {
  const s = setupWithTypes();
  unwrap(await createDocumentFolder(s.deps, s.ctx, { path: 'vorstand' }));
  insert(s, 'in-filed', { direction: 'incoming', folder: 'vorstand' });
  insert(s, 'out-filed', { direction: 'outgoing', folder: 'vorstand' });
  insert(s, 'in-box', { direction: 'incoming', folder: null });
  insert(s, 'out-loose', { direction: 'outgoing', folder: null });
  insert(s, 'out-draft', { direction: 'outgoing', folder: null, phase: 'draft' });
  insert(s, 'out-void', { direction: 'outgoing', folder: null, status: 'voided' });
  return s;
}

const ids = (r: Awaited<ReturnType<typeof listDocuments>>) => (r.ok ? r.value.documents.map((d) => d.id).sort() : []);

describe('Ohne Ordner', () => {
  it('der Filter zeigt ausgehende Dokumente ohne Ordner, der Eingangskorb nur eingehende', async () => {
    const { deps, ctx } = await world();
    expect(ids(await listDocuments(deps, ctx, { unfiled: true }))).toEqual(['out-draft', 'out-loose', 'out-void']);
    expect(ids(await listDocuments(deps, ctx, { inbox: true }))).toEqual(['in-box']);
  });

  it('Alle = Ordner + Eingangskorb + Ohne Ordner', async () => {
    const { deps, ctx } = await world();
    const all = unwrap(await listDocuments(deps, ctx, { limit: 1 })).total;
    const inbox = unwrap(await listDocuments(deps, ctx, { inbox: true, limit: 1 })).total;
    const unfiled = unwrap(await listDocuments(deps, ctx, { unfiled: true, limit: 1 })).total;
    const inFolders = unwrap(await listDocumentFolders(deps, ctx)).reduce((sum, f) => sum + f.count, 0);
    expect(all).toBe(6);
    expect(inFolders + inbox + unfiled).toBe(all);
  });

  it('das Protokoll: toInbox heißt Ziel null, outgoing kennzeichnet Ausgänge', async () => {
    const { deps, ctx } = await world();
    unwrap(await moveDocument(deps, ctx, { id: 'in-filed', folder: null }));
    unwrap(await moveDocument(deps, ctx, { id: 'out-filed', folder: null }));
    const params = (id: string) => JSON.parse(deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, id)).all().find((e) => e.action === 'dms.move')!.params!);
    // `toInbox` heißt wie bis 0.2.11 „Ziel null“; `outgoing` sagt, dass ein Ausgang aus dem Ordner genommen wurde.
    expect(params('in-filed')).toMatchObject({ toInbox: true, folder: '', outgoing: false });
    expect(params('out-filed')).toMatchObject({ toInbox: true, folder: '', outgoing: true });
  });

  it('widersprüchliche Ortsfilter lehnt die Liste ab, statt still einen zu nehmen', async () => {
    const { deps, ctx } = await world();
    for (const input of [{ inbox: true, unfiled: true }, { unfiled: true, folder: 'vorstand' }, { inbox: true, folder: 'vorstand' }, { inbox: true, folder: null }]) {
      const res = await listDocuments(deps, ctx, input);
      expect(res, JSON.stringify(input)).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ message: 'onePlaceFilter' }] } });
    }
    expect((await listDocuments(deps, ctx, { inbox: false, folder: 'vorstand' })).ok).toBe(true);
  });

  it('der Dienst nimmt einen Ausgang aus dem Ordner — er liegt dann unter „Ohne Ordner“', async () => {
    const { deps, ctx } = await world();
    unwrap(await moveDocument(deps, ctx, { id: 'out-filed', folder: null }));
    expect(ids(await listDocuments(deps, ctx, { unfiled: true }))).toContain('out-filed');
    expect(ids(await listDocuments(deps, ctx, { inbox: true }))).not.toContain('out-filed');
  });
});
