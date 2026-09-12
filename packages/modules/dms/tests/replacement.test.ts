import { describe, expect, it } from 'vitest';
import { createDraft, createReplacementDraft, fileDocument } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { relationsFor } from '../src/relations';
import { voidDocument } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

describe('createReplacementDraft', () => {
  it('legt aus einem stornierten Brief einen Entwurf mit Text, Empfänger und Bezug „ersetzt“ an', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: 'Liebe Mitglieder,', folder: null, links: [{ entityType: 'contact', entityId: 'C1', role: 'recipient' }] });
    if (!draft.ok) throw new Error('draft');
    const filed = await fileDocument(deps, ctx, { id: draft.value.id });
    if (!filed.ok) throw new Error('file');
    const notYet = await createReplacementDraft(deps, ctx, { voidedId: filed.value.id });
    expect(!notYet.ok && notYet.error.type === 'conflict' && notYet.error.code).toBe('documentNotVoided');

    await voidDocument(deps, ctx, { id: filed.value.id, reason: 'falsches Datum' });
    const replacement = await createReplacementDraft(deps, ctx, { voidedId: filed.value.id });
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(replacement.value).toMatchObject({ phase: 'draft', typeKey: 'letter', subject: 'Einladung', draftBody: 'Liebe Mitglieder,' });
    expect(replacement.value.links).toEqual([expect.objectContaining({ entityType: 'contact', entityId: 'C1', role: 'recipient' })]);
    expect(relationsFor(deps.db, filed.value.id)).toEqual([expect.objectContaining({ kind: 'replaces', direction: 'in', otherId: replacement.value.id })]);
  });

  it('bei eingegangener Post gibt es keinen Text zu übernehmen — der Entwurf ist leer', async () => {
    const { deps, ctx } = setupWithTypes();
    const inbound = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Bescheid', documentDate: '2026-09-01' });
    if (!inbound.ok) throw new Error('receive');
    await voidDocument(deps, ctx, { id: inbound.value.id, reason: 'doppelt' });
    const replacement = await createReplacementDraft(deps, ctx, { voidedId: inbound.value.id });
    expect(replacement.ok && replacement.value.draftBody).toBe('');
  });
});
