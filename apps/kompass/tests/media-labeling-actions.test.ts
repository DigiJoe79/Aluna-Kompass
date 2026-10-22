import { AI_LABELING_ENABLED_KEY, setMediaAiKind, storeMediaAsset, unwrap, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const session: { value: { deps: Deps; ctx: CallContext } | null } = { value: null };
vi.mock('@/lib/request-context', () => ({ requireSession: async () => session.value }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) }));

const { getMediaLabelingAction, uploadMediaAction } = await import('@/app/(shell)/admin/media/actions');

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

const upload = (bytes: Uint8Array, name: string, type: string) => {
  const fd = new FormData();
  fd.set('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
  return uploadMediaAction(fd);
};

/**
 * Spec Bildkennzeichnung beim Hochladen: Der Schritt nach dem Hochladen braucht Typ und Art jeder Datei, der Dialog an
 * Fotokachel und Bildfeld Name, Art und Fundstellen — mit den Rechten der Auslieferung.
 */
describe('Bildkennzeichnung: Daten für den Dialog', () => {
  let deps: Deps;
  let ctx: CallContext;
  beforeEach(() => {
    deps = createTestDeps();
    ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    session.value = { deps, ctx };
  });

  it('Hochladen nennt Typ und Art; ein Duplikat bringt seine gespeicherte Art mit', async () => {
    writeSettingInternal(deps.db, deps, ctx, AI_LABELING_ENABLED_KEY, true);
    const first = await upload(PNG, 'a.png', 'image/png');
    expect(first.status === 'success' && first.data).toMatchObject({ mimeType: 'image/png', aiKind: 'none', created: true });
    const id = (first.status === 'success' ? first.data : null) as { id: string };
    unwrap(await setMediaAiKind(deps, ctx, { id: id.id, aiKind: 'edited' }));
    const again = await upload(PNG, 'a.png', 'image/png');
    expect(again.status === 'success' && again.data).toMatchObject({ id: id.id, aiKind: 'edited', created: false });
    const pdf = await upload(PDF, 'b.pdf', 'application/pdf');
    expect(pdf.status === 'success' && pdf.data).toMatchObject({ mimeType: 'application/pdf' });
  });

  it('Hochladen bei ausgeschalteter Kennzeichnung nennt keine Art', async () => {
    const stored = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    writeSettingInternal(deps.db, deps, ctx, AI_LABELING_ENABLED_KEY, true);
    unwrap(await setMediaAiKind(deps, ctx, { id: stored.id, aiKind: 'generated' }));
    writeSettingInternal(deps.db, deps, ctx, AI_LABELING_ENABLED_KEY, false);
    const again = await upload(PNG, 'a.png', 'image/png');
    expect(again.status === 'success' && again.data).toMatchObject({ id: stored.id, aiKind: 'none' });
  });

  it('liefert Name, Typ, Art und Fundstellen einer Datei', async () => {
    writeSettingInternal(deps.db, deps, ctx, AI_LABELING_ENABLED_KEY, true);
    const stored = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    unwrap(await setMediaAiKind(deps, ctx, { id: stored.id, aiKind: 'generated' }));
    const state = await getMediaLabelingAction(stored.id);
    expect(state.status === 'success' && state.data).toEqual({ id: stored.id, filename: stored.filename, mimeType: 'image/png', aiKind: 'generated', references: [] });
  });

  it('lehnt ohne Anmeldung und bei unbekannter Datei ab', async () => {
    const stored = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    session.value = { deps, ctx: ctxWith(['media.upload'], null) };
    expect((await getMediaLabelingAction(stored.id)).status).toBe('error');
    session.value = { deps, ctx };
    expect((await getMediaLabelingAction('unbekannt')).status).toBe('error');
  });
});
