import { schema, unwrap, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDraft, createResponseDraft, fileDocument } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { relationsFor } from '../src/relations';
import { documents, documentTypes } from '../src/schema';
import { voidDocument } from '../src/service';
import { createDocumentFolder } from '../src/catalog';
import { ALL_DMS, INCOMING_OPEN_TYPE, pdfBytes, setupWithArea, setupWithTypes } from './helpers';

/** Wer antwortet, sieht in der Regel auch den Absender. */
function setup() {
  const s = setupWithTypes();
  return { ...s, ctx: ctxWith([...s.ctx.permissions, 'contacts.view'], s.userId) };
}

function outgoingDefault(deps: Deps, key = 'letter') {
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.defaultTypeOutgoing', key));
}

async function contact(deps: Deps, ctx: CallContext, lastName: string) {
  return unwrap(await createContact(deps, ctx, { kind: 'person', lastName, firstName: 'Erika', street: 'Weg 1', postalCode: '12345', city: 'Stadt' })).id;
}

async function incoming(deps: Deps, ctx: CallContext, sender: string) {
  unwrap(await createDocumentFolder(deps, ctx, { path: 'behoerden' }));
  unwrap(await createDocumentFolder(deps, ctx, { path: 'behoerden/finanzamt' }));
  return unwrap(
    await receiveDocument(deps, ctx, {
      filename: 'b.pdf',
      bytes: pdfBytes(),
      typeKey: INCOMING_OPEN_TYPE,
      subject: 'Freistellungsbescheid',
      documentDate: '2026-09-03',
      folder: 'behoerden/finanzamt',
      links: [
        { entityType: 'contact', entityId: sender, role: 'sender' },
        { entityType: 'animal', entityId: 'A1', role: 'about' },
      ],
    }),
  );
}

describe('createResponseDraft', () => {
  it('antwortet auf eingegangene Post: Ordner, Absender als Empfänger, Betreff mit Datum, betrifft-Bezüge, repliesTo', async () => {
    const { deps, ctx } = setup();
    outgoingDefault(deps);
    const sender = await contact(deps, ctx, 'Amt');
    const source = await incoming(deps, ctx, sender);

    const before = deps.db.select().from(schema.auditLog).all().length;
    const reply = unwrap(await createResponseDraft(deps, ctx, { id: source.id }));

    expect(reply).toMatchObject({ phase: 'draft', direction: 'outgoing', typeKey: 'letter', folder: 'behoerden/finanzamt', subject: 'Ihr Schreiben vom 03.09.2026: Freistellungsbescheid', draftBody: '' });
    expect(reply.links.map((l) => [l.entityType, l.entityId, l.role]).sort()).toEqual([
      ['animal', 'A1', 'about'],
      ['contact', sender, 'recipient'],
    ]);
    expect(relationsFor(deps, ctx, deps.db, source.id)).toEqual([expect.objectContaining({ kind: 'repliesTo', direction: 'in', otherId: reply.id })]);

    const entries = deps.db.select().from(schema.auditLog).all().slice(before);
    expect(entries.map((e) => e.action)).toEqual(['dms.draft.create', 'dms.relate']);
    expect(entries[0]).toMatchObject({ entityId: reply.id, params: null });
    // Der Betreff kann Personen nennen: Er steht nicht in den Werten (Spec Protokoll § 2).
    expect(JSON.parse(entries[1]!.params!)).toEqual({ number: null, relatedNumber: source.number, kind: 'repliesTo' });
  });

  it('die Antwort trägt den Tag des Vereins, nicht den UTC-Tag (22:30 UTC ist in Berlin schon morgen)', async () => {
    const { deps, ctx } = setup();
    outgoingDefault(deps);
    const source = await incoming(deps, ctx, await contact(deps, ctx, 'Amt'));
    deps.clock.set('2026-09-12T22:30:00.000Z');
    const reply = unwrap(await createResponseDraft(deps, ctx, { id: source.id }));
    expect(reply.documentDate).toBe('2026-09-13');
  });

  it('schreibt einem abgelegten eigenen Brief nach: derselbe Empfänger, „Unser Schreiben vom …“', async () => {
    const { deps, ctx } = setup();
    outgoingDefault(deps);
    const recipient = await contact(deps, ctx, 'Partner');
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: 'x', documentDate: '2026-08-14', links: [{ entityType: 'contact', entityId: recipient, role: 'recipient' }] }));
    const filed = unwrap(await fileDocument(deps, ctx, { id: draft.id }));

    const next = unwrap(await createResponseDraft(deps, ctx, { id: filed.id }));
    expect(next.subject).toBe('Unser Schreiben vom 14.08.2026: Einladung');
    expect(next.links).toEqual([expect.objectContaining({ entityType: 'contact', entityId: recipient, role: 'recipient' })]);
    expect(relationsFor(deps, ctx, deps.db, next.id)).toEqual([expect.objectContaining({ kind: 'repliesTo', direction: 'out', otherId: filed.id })]);
  });

  it('ohne Dokumentdatum fällt „vom …“ weg', async () => {
    const { deps, ctx } = setup();
    outgoingDefault(deps);
    const source = await incoming(deps, ctx, await contact(deps, ctx, 'Amt'));
    deps.db.update(documents).set({ documentDate: '' }).where(eq(documents.id, source.id)).run();
    expect(unwrap(await createResponseDraft(deps, ctx, { id: source.id })).subject).toBe('Ihr Schreiben: Freistellungsbescheid');
  });

  it('weist Entwürfe und stornierte Dokumente ab', async () => {
    const { deps, ctx } = setup();
    outgoingDefault(deps);
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Entwurf', body: '' }));
    const fromDraft = await createResponseDraft(deps, ctx, { id: draft.id });
    expect(fromDraft.ok ? 'ok' : fromDraft.error).toMatchObject({ type: 'conflict', code: 'documentIsDraft' });

    const source = await incoming(deps, ctx, await contact(deps, ctx, 'Amt'));
    unwrap(await voidDocument(deps, ctx, { id: source.id, reason: 'doppelt' }));
    const before = deps.db.select().from(documents).all().length;
    const fromVoided = await createResponseDraft(deps, ctx, { id: source.id });
    expect(fromVoided.ok ? 'ok' : fromVoided.error).toMatchObject({ type: 'conflict', code: 'documentVoided' });
    expect(deps.db.select().from(documents).all().length).toBe(before);
  });

  it('verlangt dms.create', async () => {
    const { deps, ctx } = setup();
    outgoingDefault(deps);
    const source = await incoming(deps, ctx, await contact(deps, ctx, 'Amt'));
    const res = await createResponseDraft(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.create')), { id: source.id });
    expect(res.ok ? 'ok' : res.error).toEqual({ type: 'forbidden', permission: 'dms.create' });
  });

  it('prüft die Eingabe und kennt das Dokument', async () => {
    const { deps, ctx } = setup();
    const invalid = await createResponseDraft(deps, ctx, { id: '' });
    expect(invalid.ok ? 'ok' : invalid.error.type).toBe('validation');
    const missing = await createResponseDraft(deps, ctx, { id: 'nope' });
    expect(missing.ok ? 'ok' : missing.error.type).toBe('notFound');
  });

  it('ein Absender, den der Aufrufer nicht sehen darf, wird nicht Empfänger — der Entwurf entsteht ohne', async () => {
    const { deps, ctx } = setup();
    outgoingDefault(deps);
    const source = await incoming(deps, ctx, await contact(deps, ctx, 'Amt'));
    const blind = ctxWith([...ctx.permissions].filter((p) => p !== 'contacts.view'), ctx.userId);
    const reply = unwrap(await createResponseDraft(deps, blind, { id: source.id }));
    expect(reply.links.filter((l) => l.role === 'recipient')).toEqual([]);
    expect(reply.links).toEqual([expect.objectContaining({ entityType: 'animal', role: 'about' })]);
  });

  it('Quelle in einem Bereich, den der Aufrufer nicht lesen darf: forbidden, nichts angelegt', async () => {
    const { deps, viewer, secretId } = await setupWithArea();
    outgoingDefault(deps);
    const before = deps.db.select().from(documents).all().length;
    const res = await createResponseDraft(deps, viewer, { id: secretId });
    expect(res.ok ? 'ok' : res.error).toEqual({ type: 'forbidden', permission: 'probe.read' });
    expect(deps.db.select().from(documents).all().length).toBe(before);
  });

  it('aus einer geschützten Quelle in eine offene Art: Nummer statt Betreff, keine betrifft-Bezüge, Protokoll ohne Betreff', async () => {
    const { deps, all, secretId } = await setupWithArea();
    outgoingDefault(deps);
    const secret = deps.db.select().from(documents).where(eq(documents.id, secretId)).get()!;
    const reply = unwrap(await createResponseDraft(deps, all, { id: secretId }));
    expect(reply.subject).toBe(`Ihr Schreiben vom 01.09.2026: ${secret.number}`);
    const text = JSON.stringify(deps.db.select().from(schema.auditLog).all().slice(-2));
    expect(text).not.toContain('Streng geheimer Betreff');
    expect(text).toContain(secret.number!);
  });

  it('aus einer geschützten Quelle in eine Art desselben Bereichs: Betreff bleibt, das Protokoll nennt nur Nummer und ID', async () => {
    const { deps, all, secretId } = await setupWithArea();
    deps.db.insert(documentTypes).values({ key: 'secret-out', label: 'Geheim (Ausgang)', prefix: 'GHA', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true, sortOrder: 91, ownerModule: null, protectionArea: 'probe' }).run();
    outgoingDefault(deps, 'secret-out');
    const reply = unwrap(await createResponseDraft(deps, all, { id: secretId }));
    expect(reply.subject).toBe('Ihr Schreiben vom 01.09.2026: Streng geheimer Betreff');
    const text = JSON.stringify(deps.db.select().from(schema.auditLog).all().slice(-2));
    expect(text).not.toContain('Streng geheimer Betreff');
  });
});
