import { schema, setSetting } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { clearDispatch, recordDispatch } from '../src/dispatch';
import { createDraft, fileDocument } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { documents } from '../src/schema';
import { ALL_DMS, auditActions, fileFixture, pdfBytes, setupWithTypes } from './helpers';

describe('Versandvermerk', () => {
  it('vermerkt Datum, Weg und Bemerkung an einem festgeschriebenen Brief', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const sent = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'post', note: 'mit Anlagen' });
    expect(sent.ok && [sent.value.sentAt, sent.value.sentVia, sent.value.sentNote]).toEqual(['2026-09-05', 'post', 'mit Anlagen']);
    expect(auditActions(deps)).toContain('dms.dispatch');
  });

  it('ändert nachträglich mit Vorher und Nachher im Protokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    // Eigener Brief mit älterem Dokumentdatum: Der zweite Vermerk liegt vor dem
    // ersten, und beide müssen nach dem Datum auf dem Dokument liegen.
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Korrektur', body: 'x', documentDate: '2026-09-01' });
    if (!draft.ok) throw new Error('draft');
    const letter = await fileDocument(deps, ctx, { id: draft.value.id });
    if (!letter.ok) throw new Error('file');
    await recordDispatch(deps, ctx, { id: letter.value.id, sentAt: '2026-09-05', sentVia: 'post' });
    await recordDispatch(deps, ctx, { id: letter.value.id, sentAt: '2026-09-04', sentVia: 'email' });
    const entry = deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'dms.dispatch').at(-1)!;
    expect(JSON.parse(entry.before!)).toMatchObject({ sentAt: '2026-09-05', sentVia: 'post' });
    expect(JSON.parse(entry.after!)).toMatchObject({ sentAt: '2026-09-04', sentVia: 'email' });
  });

  it('weist Entwurf, Eingang, unbekannten Weg, Datum vor dem Dokument und Zukunft ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    const inbound = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 's', documentDate: '2026-09-01' });
    const letter = await fileFixture(deps, ctx);
    if (!draft.ok || !inbound.ok) throw new Error('fixture');
    const onDraft = await recordDispatch(deps, ctx, { id: draft.value.id, sentAt: '2026-09-05', sentVia: 'post' });
    expect(!onDraft.ok && onDraft.error.type === 'conflict' && onDraft.error.code).toBe('documentIsDraft');
    const onInbound = await recordDispatch(deps, ctx, { id: inbound.value.id, sentAt: '2026-09-05', sentVia: 'post' });
    expect(!onInbound.ok && onInbound.error.type === 'conflict' && onInbound.error.code).toBe('notOutgoing');
    const via = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'carrierPigeon' });
    expect(!via.ok && via.error.type === 'validation' && via.error.issues[0]?.path).toBe('sentVia');
    const early = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2020-01-01', sentVia: 'post' });
    expect(!early.ok && early.error.type === 'validation' && early.error.issues[0]?.path).toBe('sentAt');
    const future = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2027-01-01', sentVia: 'post' });
    expect(!future.ok && future.error.type).toBe('validation');
  });

  it('ein aus der Einstellung entfernter Weg bleibt am Dokument stehen', async () => {
    const { deps, ctx } = setupWithTypes([...ALL_DMS, 'settings.manage']);
    const letter = await fileFixture(deps, ctx);
    await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'portal' });
    const without = await setSetting(deps, ctx, { key: 'dms.dispatchChannels', value: [{ key: 'post', label: 'Post' }] });
    expect(without.ok).toBe(true);
    const again = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'portal' });
    expect(!again.ok && again.error.type).toBe('validation');
    const row = deps.db.select().from(documents).all().find((d) => d.id === letter.id)!;
    expect(row.sentVia).toBe('portal');
  });

  it('leert den Vermerk mit Protokoll und braucht das Recht', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'post' });
    const { ctx: reader } = setupWithTypes(['dms.view']);
    const denied = await clearDispatch(deps, reader, { id: letter.id });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
    const cleared = await clearDispatch(deps, ctx, { id: letter.id });
    expect(cleared.ok && cleared.value.sentAt).toBeNull();
    expect(auditActions(deps)).toContain('dms.dispatch.clear');
  });
});
