import { createHash } from 'node:crypto';
import { coreModule } from '@kompass/core';
import { createTestDeps, ctxWith, fakeDocumentEngine, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { createDraft, deleteDraft, fileDocument, updateDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { deleteDocument, voidDocument } from '../src/service';
import { ALL_DMS, auditActions, fileFixture, pdfBytes, seedTypes, setupWithTypes } from './helpers';

describe('fileDocument', () => {
  /**
   * Das Feld heißt „Datum auf dem Dokument“ — also steht es auch darauf. Wer
   * am 12. September einen Brief festschreibt, den er auf den 10. Februar
   * datiert hat, tut das bewusst; das Festschreibedatum steht im Protokoll.
   */
  it('druckt das Datum auf dem Dokument, nicht das Datum des Festschreibens', async () => {
    const rendered: string[] = [];
    const deps = createTestDeps({
      manifests: [coreModule, contactsModule, dmsModule],
      documents: fakeDocumentEngine({
        render: async ({ context }) => {
          rendered.push(context.issuedAt);
          return { bytes: pdfBytes(), pages: 1 };
        },
      }),
    });
    seedTypes(deps);
    const ctx = ctxWith(ALL_DMS, insertUser(deps, {}));
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: 'x', documentDate: '2026-02-10' });
    if (!draft.ok) throw new Error('setup');
    const filed = await fileDocument(deps, ctx, { id: draft.value.id });
    expect(filed.ok).toBe(true);
    expect(rendered.at(-1)).toMatch(/^2026-02-10/);
  });

  it('vergibt die Nummer, legt das PDF ab und leert den Entwurfstext', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: '# Einladung' });
    if (!draft.ok) throw new Error('setup');
    const filed = await fileDocument(deps, ctx, { id: draft.value.id });
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.value.phase).toBe('issued');
    expect(filed.value.number).toMatch(/^BRF-\d{4}-\d{3}$/);
    expect(filed.value.fileName).not.toBeNull();
    expect(filed.value.draftBody).toBeNull();
  });

  it('hält die Prüfsumme der abgelegten Datei fest', async () => {
    const { deps, ctx } = setupWithTypes();
    const filed = await fileFixture(deps, ctx);
    const bytes = await deps.files('dms').read(filed.fileName as string);
    expect(filed.fileChecksum).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('lehnt das zweite Festschreiben ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const filed = await fileFixture(deps, ctx);
    const again = await fileDocument(deps, ctx, { id: filed.id });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.type).toBe('conflict');
  });

  it('vergibt lückenlose Nummern je Präfix und Jahr', async () => {
    const { deps, ctx } = setupWithTypes();
    const first = await fileFixture(deps, ctx);
    const second = await fileFixture(deps, ctx);
    expect(first.number).toMatch(/-001$/);
    expect(second.number).toMatch(/-002$/);
  });

  it('verlangt dms.file', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('setup');
    const denied = await fileDocument(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.file')), { id: draft.value.id });
    expect(denied.ok).toBe(false);
  });

  it('reicht Basis, Slots und Nummer unverändert an die Engine', async () => {
    const calls: unknown[] = [];
    const deps = createTestDeps({
      manifests: [coreModule, contactsModule, dmsModule],
      documents: fakeDocumentEngine({ render: async (args) => { calls.push(args); return { bytes: new TextEncoder().encode('%PDF-fake'), pages: 1 }; } }),
    });
    seedTypes(deps);
    const ctx = ctxWith(ALL_DMS, insertUser(deps, { name: 'T', email: 't@kompass.local' }));
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: '# Einladung' });
    if (!draft.ok) throw new Error('setup');
    await fileDocument(deps, ctx, { id: draft.value.id });
    expect(calls).toHaveLength(1);
    const call = calls[0] as { baseId: string; slots: { subject?: string; draft?: boolean }; context: { number: string } };
    expect(call.baseId).toBe('a4-mit-briefkopf');
    expect(call.slots.subject).toBe('Einladung');
    expect(call.slots.draft).toBeFalsy(); // kein Wasserzeichen auf dem Original
    expect(call.context.number).toMatch(/^BRF-\d{4}-\d{3}$/);
  });

  it('schreibt einen Eintrag ins Änderungsprotokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    await fileFixture(deps, ctx);
    expect(auditActions(deps)).toContain('dms.file');
  });

  it('lässt ein festgeschriebenes Dokument nicht mehr ändern', async () => {
    const { deps, ctx } = setupWithTypes();
    const filed = await fileFixture(deps, ctx);
    const changed = await updateDraft(deps, ctx, { id: filed.id, subject: 'Anders', body: 'anders' });
    expect(changed.ok).toBe(false);
    if (changed.ok) return;
    expect(changed.error.type).toBe('conflict');
  });

  it('lässt ein festgeschriebenes Dokument nicht als Entwurf löschen', async () => {
    const { deps, ctx } = setupWithTypes();
    const filed = await fileFixture(deps, ctx);
    const deleted = await deleteDraft(deps, ctx, { id: filed.id });
    expect(deleted.ok).toBe(false);
  });

  it('storniert statt zu ändern', async () => {
    const { deps, ctx } = setupWithTypes();
    const filed = await fileFixture(deps, ctx);
    const voided = await voidDocument(deps, ctx, { id: filed.id, reason: 'Falscher Empfänger' });
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;
    expect(voided.value.status).toBe('voided');
    expect(voided.value.number).toBe(filed.number); // die Nummer bleibt vergeben
  });
});

describe('Nummernvergabe', () => {
  it('vergibt nach einer Löschung keine schon benutzte Nummer erneut', async () => {
    const { deps, ctx } = setupWithTypes();
    const expired = await receiveDocument(deps, ctx, {
      filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alt', documentDate: '2005-06-01',
    });
    const kept = await receiveDocument(deps, ctx, {
      filename: 'jung.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Jung', documentDate: '2026-01-01',
    });
    if (!expired.ok || !kept.ok) throw new Error('setup');
    expect(expired.value.number).toMatch(/-001$/);
    expect(kept.value.number).toMatch(/-002$/);

    const deleted = await deleteDocument(deps, ctx, { id: expired.value.id });
    expect(deleted.ok).toBe(true);

    const next = await receiveDocument(deps, ctx, {
      filename: 'neu.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Neu', documentDate: '2026-02-01',
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.number).toMatch(/-003$/);
  });

});
