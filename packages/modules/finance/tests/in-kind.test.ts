import { schema, unwrap } from '@kompass/core';
import { ctxWith, fakeDocumentEngine } from '@kompass/core/testing';
import { documentLinks } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkConfirmable } from '../src/donations/check';
import { issueConfirmation, voidConfirmation } from '../src/donations/confirmations';
import { getInKindDetails, saveInKindDetails } from '../src/donations/in-kind';
import { deleteDraft, getEntry, saveDraft } from '../src/ledger/entries';
import { financeConfirmations, financeInKindDetails } from '../src/schema';
import { insertDocument } from './helpers';
import { donationFixture, err, type DonationFixture } from './donation-fixture';

const details = { item: 'Hundebox aus Aluminium, Größe L', condition: 'gebraucht, zwei Jahre alt, guter Zustand', valuation: 'Kaufpreis 2024 laut Rechnung 390 €, abzüglich Gebrauch', origin: 'private' as const };
const auditOf = (f: DonationFixture, action: string) => f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).all();

describe('saveInKindDetails', () => {
  it('N1: a draft whose in-kind line carries details can still be deleted — the details go with it', async () => {
    const f = await donationFixture();
    const draft = unwrap(
      await saveDraft(f.deps, f.ctx, {
        entryDate: '2026-03-07', text: 'Sachspende', moneyLines: [],
        allocationLines: [
          { categoryId: f.categoryByKey('in-kind-donations').id, amountCents: 25000, contactId: f.erika.id },
          { categoryId: f.categoryByKey('program-in-kind').id, amountCents: -25000 },
        ],
      }),
    );
    const line = draft.allocationLines.find((l) => l.amountCents > 0)!;
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: line.id, ...details }));
    expect(unwrap(await deleteDraft(f.deps, f.ctx, { id: draft.id }))).toEqual({ id: draft.id });
    expect(f.deps.db.select().from(financeInKindDetails).all()).toEqual([]);
  });

  it('stores the details at the in-kind line, hangs the valuation document on the entry as voucher, and logs no free text', async () => {
    const f = await donationFixture();
    const gift = await f.giveInKind();
    const proof = insertDocument(f, { subject: 'Rechnung der Hundebox' });
    const saved = unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, proofDocumentId: proof }));
    expect(saved).toMatchObject({ lineId: gift.line.id, ...details, withdrawalValueCents: null, vatCents: null, proofDocumentId: proof });

    const entry = unwrap(await getEntry(f.deps, f.ctx, { id: gift.entry.id }));
    expect(entry.vouchers.map((v) => v.documentId)).toEqual([proof]);
    expect(entry.documentation.state).toBe('voucher');
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, proof), eq(documentLinks.entityType, 'financeEntry'), eq(documentLinks.entityId, gift.entry.id))).all()).toHaveLength(1);

    // Ein zweites Speichern mit derselben Wertunterlage hängt sie nicht doppelt an.
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, condition: 'neuwertig', proofDocumentId: proof }));
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: gift.entry.id })).vouchers).toHaveLength(1);

    const [first] = auditOf(f, 'finance.inKindDetails.save');
    expect(first).toMatchObject({ entityType: 'financeInKindDetails', entityId: gift.line.id });
    expect(JSON.parse(first!.after as string)).toEqual({ lineId: gift.line.id, origin: 'private', withdrawalValueCents: null, vatCents: null, proofDocumentId: proof });
    expect(JSON.stringify(auditOf(f, 'finance.inKindDetails.save'))).not.toMatch(/Hundebox|gebraucht|Kaufpreis|neuwertig/);
  });

  it('needs finance.entriesWrite; reading needs finance.read', async () => {
    const f = await donationFixture();
    const gift = await f.giveInKind();
    expect(err(await saveInKindDetails(f.deps, ctxWith(['finance.read'], f.userId), { lineId: gift.line.id, ...details }))).toEqual({ type: 'forbidden', permission: 'finance.entriesWrite' });
    expect(err(await getInKindDetails(f.deps, ctxWith(['finance.overview'], f.userId), { lineId: gift.line.id }))).toMatchObject({ type: 'forbidden' });
    expect(unwrap(await getInKindDetails(f.deps, f.ctx, { lineId: gift.line.id }))).toBeNull();
  });

  it('validates: business origin needs withdrawal value and vat; text fields are required', async () => {
    const f = await donationFixture();
    const gift = await f.giveInKind();
    expect(err(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, origin: 'business' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, item: ' ' }))).toMatchObject({ type: 'validation' });
    const business = unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, origin: 'business', withdrawalValueCents: 21000, vatCents: 3990 }));
    expect(business).toMatchObject({ origin: 'business', withdrawalValueCents: 21000, vatCents: 3990 });
    expect(err(await saveInKindDetails(f.deps, f.ctx, { lineId: 'nope', ...details }))).toMatchObject({ type: 'notFound' });
  });

  it('only an in-kind line carries details', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    expect(err(await saveInKindDetails(f.deps, f.ctx, { lineId: line.id, ...details }))).toMatchObject({ type: 'conflict', code: 'inKindLineOnly' });
  });

  it('refuses a draft or voided valuation document', async () => {
    const f = await donationFixture();
    const gift = await f.giveInKind();
    const voided = insertDocument(f, { subject: 'Widerrufen', voided: true });
    expect(err(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, proofDocumentId: voided }))).toMatchObject({ type: 'conflict', code: 'documentVoided' });
  });

  it('stays changeable until a valid confirmation carries the line, and again after it is withdrawn', async () => {
    const f = await donationFixture();
    const gift = await f.giveInKind();
    const proof = insertDocument(f, { subject: 'Rechnung' });
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, proofDocumentId: proof }));
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(err(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, condition: 'anders' }))).toMatchObject({ type: 'conflict', code: 'confirmationLineAlreadyConfirmed' });
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'Zustand falsch', alreadySent: false }));
    expect(unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, condition: 'anders', proofDocumentId: proof })).condition).toBe('anders');
  });
});

describe('prüfstein 5', () => {
  it('prüfstein 5: an in-kind donation without money flow gets its details and an in-kind confirmation', async () => {
    const f = await donationFixture({ machine: true });
    const gift = await f.giveInKind({ cents: 25000 });
    expect(gift.entry.moneyLines).toHaveLength(0);

    const before = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(before.checks.filter((c) => c.blocked).map((c) => c.key)).toEqual(['documented', 'inKindDetails']);

    const proof = insertDocument(f, { subject: 'Wertgutachten' });
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, proofDocumentId: proof }));
    const after = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(after.ok).toBe(true);

    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    // Sachzuwendungen entstehen immer mit Unterschriftsfeld, auch wenn das Verfahren vollständig ist.
    expect(confirmation).toMatchObject({ kind: 'inKind', totalCents: 25000, machine: false, signerId: null, signatureState: 'needsSignature', state: 'valid' });
    expect(confirmation.documentNumber).toMatch(/^ZWB-/);
    const row = f.deps.db.select().from(financeConfirmations).where(eq(financeConfirmations.id, confirmation.id)).get()!;
    expect(row.totalCents).toBe(25000);
    expect(f.deps.db.select().from(financeInKindDetails).where(eq(financeInKindDetails.lineId, gift.line.id)).get()!.proofDocumentId).toBe(proof);
  });
});

/**
 * Ein-Seiten-Grenze (BMF 7.11.2013 Nr. 2, Kurskorrektur 2026-09-27): Die
 * Einzel- und die Sachzuwendungsbestätigung werden nie über zwei Seiten
 * ausgestellt. Die Engine hier meldet die Seitenzahl, die der echte Render
 * für solche Beschreibungen ergibt (200/200/400 unter einer Vereinsbasis mit
 * größerer Schrift, 500/500/1000 auch unter der mitgelieferten — belegt in
 * `apps/kompass/tests/finance-donation-templates-render.test.ts`).
 */
describe('one page only (BMF Nr. 2)', () => {
  const txt = (n: number, c: string) => c.repeat(Math.ceil(n / c.length)).slice(0, n);
  const pages = (f: DonationFixture, n: number) => {
    f.deps.documents = fakeDocumentEngine({ render: async () => ({ bytes: new TextEncoder().encode('%PDF-fake'), pages: n }) });
  };

  for (const [item, condition, valuation] of [[200, 200, 400], [500, 500, 1000]] as const) {
    it(`refuses an in-kind confirmation that does not fit on one page (${item}/${condition}/${valuation} characters), and keeps nothing`, async () => {
      const f = await donationFixture();
      pages(f, 2);
      const gift = await f.giveInKind();
      const proof = insertDocument(f, { subject: 'Rechnung' });
      unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, origin: 'private', item: txt(item, 'Hundebox Alu '), condition: txt(condition, 'gebraucht gut '), valuation: txt(valuation, 'Kaufpreis laut Rechnung '), proofDocumentId: proof }));
      const before = f.deps.db.select().from(schema.auditLog).all().length;
      expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [gift.line.id] }))).toMatchObject({ type: 'conflict', code: 'confirmationTooLong' });
      expect(f.deps.db.select().from(financeConfirmations).all()).toHaveLength(0);
      expect(f.deps.db.select().from(schema.auditLog).all().length).toBe(before);
    });
  }

  it('issues the in-kind confirmation when it fits on one page', async () => {
    const f = await donationFixture();
    pages(f, 1);
    const gift = await f.giveInKind();
    const proof = insertDocument(f, { subject: 'Rechnung' });
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...details, proofDocumentId: proof }));
    expect(unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [gift.line.id] })).kind).toBe('inKind');
  });

  it('refuses a money confirmation over two pages; a collective confirmation may have its attachment page', async () => {
    const f = await donationFixture();
    pages(f, 2);
    const one = await f.donate();
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [one.line.id] }))).toMatchObject({ type: 'conflict', code: 'confirmationTooLong' });
    const two = await f.donate();
    expect(unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [one.line.id, two.line.id], kind: 'collective' })).kind).toBe('collective');
  });
});
