import { documentSnapshot, prepare, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkConfirmableInternal } from '../src/donations/check';
import { buildConfirmationInputInternal, issueConfirmation, previewConfirmation } from '../src/donations/confirmations';
import { donationFixture, err, type DonationFixture } from './donation-fixture';

const checkOf = (f: DonationFixture, lineIds: string[], issuedOn = '2026-03-20') => unwrap(checkConfirmableInternal(f.deps.db, f.deps, { lineIds, issuedOn }));

/** Die Aufrufe der Render-Engine mitschreiben, ohne sie zu ersetzen. */
function recordRenders(f: DonationFixture) {
  const calls: Parameters<DonationFixture['deps']['documents']['render']>[0][] = [];
  const original = f.deps.documents.render.bind(f.deps.documents);
  f.deps.documents.render = async (args) => {
    calls.push(args);
    return original(args);
  };
  return calls;
}

describe('buildConfirmationInputInternal', () => {
  it('builds the template input without facsimile bytes in the snapshot', async () => {
    const f = await donationFixture({ machine: true });
    const { line } = await f.donate({ cents: 11919 });
    const built = unwrap(await buildConfirmationInputInternal(f.deps, checkOf(f, [line.id]), { issuedOn: '2026-03-20' }));

    expect(built).toMatchObject({ kind: 'money', templateKey: 'finance-confirmation-money', machine: true, totalCents: 11919, periodFrom: null, periodTo: null, noticeId: f.notice!.id, signerId: f.signerId });
    expect(built.input).toMatchObject({ amountCents: 11919, donatedOn: '2026-03-05', issuedOn: '2026-03-20', machine: true, signerName: 'Jonas Feld', expenseWaiver: false, recipient: { name: 'Erika Beispiel' } });
    expect((built.input as { facsimile: { bytes: Uint8Array } }).facsimile.bytes).toBeInstanceOf(Uint8Array);

    // Was die Akte ablegt: die Prüfsumme des Faksimiles, nie seine Bytes.
    const prepared = unwrap(await prepare(f.deps, f.ctx, { templateKey: built.templateKey, input: built.input }, { number: 'ENTWURF', issuedOn: '2026-03-20' }));
    const snapshot = documentSnapshot(prepared, built.input) as { input: { facsimile: Record<string, unknown> }; images: Record<string, string> };
    expect(snapshot.input.facsimile).toEqual({ checksum: built.facsimileChecksum, mimeType: 'image/png' });
    expect(snapshot.images).toEqual({ signature: built.facsimileChecksum });
  });

  it('is the input issueConfirmation files', async () => {
    const f = await donationFixture({ machine: true });
    const { line } = await f.donate({ cents: 4200 });
    const built = unwrap(await buildConfirmationInputInternal(f.deps, checkOf(f, [line.id]), { issuedOn: '2026-03-20' }));
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    const filed = JSON.parse(f.deps.db.select().from(documents).where(eq(documents.id, confirmation.documentId)).get()!.inputSnapshot!) as { input: unknown };
    expect(filed.input).toEqual(JSON.parse(JSON.stringify(built.input, (_k, v: unknown) => (v instanceof Uint8Array ? undefined : v))));
  });

  it('falls back to a signature field without a complete machine procedure, and for an expense waiver', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const plain = unwrap(await buildConfirmationInputInternal(f.deps, checkOf(f, [line.id]), { issuedOn: '2026-03-20' }));
    expect(plain).toMatchObject({ machine: false, signerId: null, facsimileChecksum: null });
    expect(plain.input).not.toHaveProperty('facsimile');

    const g = await donationFixture({ machine: true });
    const waived = await g.waive();
    const built = unwrap(await buildConfirmationInputInternal(g.deps, checkOf(g, [waived.line.id]), { issuedOn: '2026-03-20' }));
    expect(built).toMatchObject({ machine: false, input: { expenseWaiver: true } });
  });

  it('refuses what issueConfirmation refuses: several lines outside a collective, a date before the donation, lines of two years', async () => {
    const f = await donationFixture();
    const a = await f.donate({ date: '2026-01-15', cents: 1000 });
    const b = await f.donate({ date: '2026-03-01', cents: 2000 });
    const check = checkOf(f, [a.line.id, b.line.id]);
    expect(err(await buildConfirmationInputInternal(f.deps, check, { issuedOn: '2026-03-20', kind: 'money' }))).toMatchObject({ type: 'validation' });
    expect(err(await buildConfirmationInputInternal(f.deps, check, { issuedOn: '2026-02-01' }))).toMatchObject({ type: 'validation' });
    const collective = unwrap(await buildConfirmationInputInternal(f.deps, check, { issuedOn: '2026-03-20' }));
    expect(collective).toMatchObject({ kind: 'collective', templateKey: 'finance-confirmation-collective', periodFrom: '2026-01-15', periodTo: '2026-03-01', totalCents: 3000 });

    const old = await f.donate({ date: '2025-12-20', cents: 500 });
    expect(err(await buildConfirmationInputInternal(f.deps, checkOf(f, [old.line.id, a.line.id]), { issuedOn: '2026-03-20' }))).toMatchObject({ type: 'validation' });
  });
});

describe('previewConfirmation', () => {
  it('renders the draft with the watermark and the number ENTWURF, files nothing and writes no audit entry', async () => {
    const f = await donationFixture({ machine: true });
    const { line } = await f.donate();
    const calls = recordRenders(f);
    const auditBefore = f.deps.db.select().from(schema.auditLog).all().length;
    const documentsBefore = f.deps.db.select().from(documents).all().length;

    const preview = unwrap(await previewConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(preview.mimeType).toBe('application/pdf');
    expect(new TextDecoder().decode(preview.bytes)).toMatch(/^%PDF/);
    expect(preview.filename).toBe('Zuwendungsbestaetigung-Entwurf.pdf');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.slots.draft).toBe(true);
    expect(calls[0]!.context.number).toBe('ENTWURF');
    expect(calls[0]!.baseId).toBe('a4-formular');
    expect(Object.keys(calls[0]!.images ?? {})).toEqual(['signature']);
    expect(f.deps.db.select().from(schema.auditLog).all()).toHaveLength(auditBefore);
    expect(f.deps.db.select().from(documents).all()).toHaveLength(documentsBefore);
  });

  it('needs finance.donationsIssue, validates its input and answers a blocking check with its reason', async () => {
    const f = await donationFixture({ notice: false });
    const { line } = await f.donate();
    expect(err(await previewConfirmation(f.deps, ctxWith(['finance.read'], f.userId), { lineIds: [line.id] }))).toMatchObject({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await previewConfirmation(f.deps, f.ctx, { lineIds: [] }))).toMatchObject({ type: 'validation' });
    expect(err(await previewConfirmation(f.deps, f.ctx, { lineIds: [line.id], issuedOn: '2026-03-21' }))).toMatchObject({ type: 'validation' });
    expect(err(await previewConfirmation(f.deps, f.ctx, { lineIds: [line.id] }))).toMatchObject({ type: 'conflict', code: 'noNoticeValidAt' });
  });

  it('is not human only: the preview changes nothing', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    expect((await previewConfirmation(f.deps, { ...f.ctx, channel: 'mcp' }, { lineIds: [line.id] })).ok).toBe(true);
  });
});
