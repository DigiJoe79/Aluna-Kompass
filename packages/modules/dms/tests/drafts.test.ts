import { coreModule, defineModule, schema } from '@kompass/core';
import { createTestDeps, ctxWith, fakeDocumentEngine, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dmsModule } from '../src/manifest';
import { documents } from '../src/schema';
import { createDraft, deleteDraft, previewDraft, updateDraft } from '../src/drafts';
import { ALL_DMS, auditActions, seedTypes, setupWithTypes } from './helpers';

describe('createDraft', () => {
  it('legt einen Entwurf ohne Nummer und ohne Datei an', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: '# Einladung\n\nHallo.' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.phase).toBe('draft');
    expect(created.value.number).toBeNull();
    expect(created.value.assetId).toBeNull();
    expect(created.value.draftBody).toContain('Einladung');
  });

  it('lehnt eine unbekannte Dokumentart ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await createDraft(deps, ctx, { typeKey: 'gibtsnicht', subject: 'x', body: 'y' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('notFound');
  });

  it('verlangt dms.create', async () => {
    const { deps } = setupWithTypes();
    const denied = await createDraft(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.create')), { typeKey: 'letter', subject: 'x', body: 'y' });
    expect(denied.ok).toBe(false);
  });

  it('verlangt einen Betreff', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await createDraft(deps, ctx, { typeKey: 'letter', subject: '', body: 'y' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
  });

  it('schreibt einen Eintrag ins Änderungsprotokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: 'x' });
    expect(auditActions(deps)).toContain('dms.draft.create');
  });
});

describe('updateDraft', () => {
  it('ändert den Text eines Entwurfs', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Alt', body: 'alt' });
    if (!created.ok) throw new Error('setup');
    const updated = await updateDraft(deps, ctx, { id: created.value.id, subject: 'Neu', body: 'neu' });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.subject).toBe('Neu');
  });
});

describe('deleteDraft', () => {
  it('wirft einen Entwurf weg', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Weg', body: 'x' });
    if (!created.ok) throw new Error('setup');
    const deleted = await deleteDraft(deps, ctx, { id: created.value.id });
    expect(deleted.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.draft.delete');
  });

  it('verlangt dms.deleteDraft', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Weg', body: 'x' });
    if (!created.ok) throw new Error('setup');
    const denied = await deleteDraft(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.deleteDraft')), { id: created.value.id });
    expect(denied.ok).toBe(false);
  });
});

describe('previewDraft', () => {
  it('rendert mit Entwurfskennzeichnung', async () => {
    const calls: { slots: { draft?: boolean } }[] = [];
    const deps = createTestDeps({
      manifests: [coreModule, contactsModule, dmsModule],
      documents: fakeDocumentEngine({
        render: async (args) => {
          calls.push(args as { slots: { draft?: boolean } });
          return new TextEncoder().encode('%PDF-fake');
        },
      }),
    });
    seedTypes(deps);
    const ctx = ctxWith(ALL_DMS, insertUser(deps, { name: 'T', email: 't@kompass.local' }));
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Test', body: 'Hallo' });
    if (!draft.ok) throw new Error('setup');
    await previewDraft(deps, ctx, { id: draft.value.id });
    expect(calls[0]?.slots.draft).toBe(true);
  });

  it('rendert eine Vorschau, ohne etwas abzulegen', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Test', body: 'Hallo' });
    if (!draft.ok) throw new Error('setup');
    const before = deps.db.select().from(schema.mediaAssets).all().length;
    const preview = await previewDraft(deps, ctx, { id: draft.value.id });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.mimeType).toBe('application/pdf');
    expect(preview.value.bytes.byteLength).toBeGreaterThan(0);
    expect(deps.db.select().from(schema.mediaAssets).all().length).toBe(before);
    expect(deps.db.select().from(documents).get()?.number).toBeNull();
  });
});

describe('Vorlagenwahl beim Entwurf', () => {
  /** Ein Modul, das eine eigene Vorlage unter dem Schlüssel einer Dokumentart mitbringt. */
  const minutesModule = defineModule({
    key: 'minutes-demo',
    version: '0.0.1',
    permissions: [],
    documentTemplates: [
      {
        key: 'minutes',
        type: 'minutes',
        schema: z.object({ subject: z.string(), body: z.string(), recipient: z.string().default('') }),
        base: 'a4-mit-briefkopf',
        build: (data: { subject: string; body: string }) => ({
          slots: { kind: 'minutes', subject: data.subject, title: data.subject },
          body: { markdown: data.body },
        }),
      },
    ],
  });

  function setupWithMinutes() {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, minutesModule] });
    seedTypes(deps);
    const ctx = ctxWith([...ALL_DMS, 'media.upload'], insertUser(deps, { name: 'T', email: 't@kompass.local' }));
    return { deps, ctx };
  }

  it('nimmt die Vorlage, die den Schlüssel der Dokumentart trägt', async () => {
    const { deps, ctx } = setupWithMinutes();
    const created = await createDraft(deps, ctx, { typeKey: 'minutes', subject: 'Sitzung', body: 'Text' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.templateKey).toBe('minutes');
  });

  it('fällt auf den freien Brief zurück, wenn die Art keine eigene Vorlage hat', async () => {
    const { deps, ctx } = setupWithMinutes();
    const created = await createDraft(deps, ctx, { typeKey: 'invoice', subject: 'Rechnung', body: 'Text' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.templateKey).toBe('letter');
  });
});
