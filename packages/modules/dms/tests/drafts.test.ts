import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDraft, deleteDraft, updateDraft } from '../src/drafts';
import { ALL_DMS, auditActions, setupWithTypes } from './helpers';

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
