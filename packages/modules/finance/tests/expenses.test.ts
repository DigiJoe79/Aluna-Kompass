import { schema, unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, ctxWith, systemContext } from '@kompass/core/testing';
import { contactRoles } from '@kompass/module-contacts';
import { DOCUMENT_MAX_BYTES, documentLinks, documents } from '@kompass/module-dms';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  copyExpenseClaim,
  deleteExpenseDraft,
  expenseFormStart,
  getExpenseClaim,
  listMyExpenseClaims,
  readExpenseReceipt,
  saveExpenseDraft,
  submitExpenseClaim,
  uploadExpenseReceipt,
  type ExpenseClaimView,
} from '../src/allocation/expenses';
import { setDatedValue } from '../src/ledger/dated-values';
import { bookEntry } from '../src/ledger/finalize';
import { financeRecordDeleted } from '../src/ledger/holds';
import { createOpenItem } from '../src/ledger/open-items';
import { financeContactBankAccounts, financeContactWaiverTerms, financeExpenseClaims, financeExpensePositions } from '../src/schema';
import { expenseFixture, jpegBytes, type ExpenseFixture } from './expense-fixture';

/**
 * F8a Task 2 — der Antrag der einreichenden Person: Entwurf mit laufender
 * Sicherung, Beleg im Namen des Vorgangs, Einreichen, eigene Liste, Kopie.
 * Die Helferinnen tragen nur `finance.expensesSubmit` (Spec 10.1: das einzige
 * Finanzrecht ohne `finance.read`).
 */
const IBAN = 'DE66999999991234567890';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/** Ein vollständiger Entwurf: ein Beleg mit PDF, eine Fahrt, IBAN — bereit zum Einreichen. */
async function readyDraft(f: ExpenseFixture, who: ExpenseFixture['hanna'] = f.hanna, o: { iban?: string | null; waiver?: boolean } = {}): Promise<ExpenseClaimView> {
  const draft = unwrap(
    await saveExpenseDraft(f.deps, who.ctx, {
      iban: o.iban === undefined ? IBAN : o.iban,
      waiver: o.waiver ?? false,
      positions: [
        { kind: 'receipt', positionDate: '2026-08-20', amountCents: 1999, purpose: 'Futter für die Pflegestelle' },
        { kind: 'trip', positionDate: '2026-08-21', tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Tierarztfahrt', tripKm: 84 },
      ],
    }),
  );
  return unwrap(await uploadExpenseReceipt(f.deps, who.ctx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: f.pdf(), fileName: 'rechnung.pdf' }));
}

const enableWaivers = (f: ExpenseFixture, on = true) => f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiversEnabled', on, 'test'));

describe('saveExpenseDraft', () => {
  it('saves an incomplete draft for the own contact and refuses without a contact link, naming who can set it', async () => {
    const f = await expenseFixture();
    const draft = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, positions: [{ kind: 'receipt' }] }));
    expect(draft).toMatchObject({
      state: 'draft', number: null, contactId: f.hanna.contactId, submittedByUserId: f.hanna.userId, contactName: 'Hanna Helferin', totalCents: 0, iban: null, ibanMasked: null, paid: null, stateLabelKey: 'draft',
      positions: [{ kind: 'receipt', amountCents: 0, purpose: '', positionDate: null, documentId: null, sortOrder: 0 }],
    });
    expect(draft.version).toBe(draft.updatedAt);

    // Idempotent über die ID: derselbe Antrag, dieselbe Position, nichts verworfen.
    const again = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { id: draft.id, expectedVersion: draft.version, waiver: false, iban: 'de66 9999 9999 1234 5678 90', positions: [{ id: draft.positions[0]!.id, kind: 'receipt', amountCents: 1250, purpose: 'Futter' }] }));
    expect(again).toMatchObject({ id: draft.id, totalCents: 1250, iban: IBAN, ibanMasked: 'DE66 **** **** **** **78 90', positions: [{ id: draft.positions[0]!.id, amountCents: 1250, purpose: 'Futter' }] });
    expect(f.deps.db.select().from(financeExpenseClaims).all()).toHaveLength(1);

    const refused = await saveExpenseDraft(f.deps, f.unlinked, { waiver: false, positions: [] });
    expect(err(refused)).toMatchObject({ type: 'conflict', code: 'expenseNeedsContactLink', message: expect.stringContaining('Vera Verwalterin') });
    expect(f.deps.db.select().from(financeExpenseClaims).all()).toHaveLength(1);
  });

  it('computes the trip amount from km and the rate at the position date', async () => {
    const f = await expenseFixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'mileageRate', validFrom: '2026-06-01', value: 35 }));
    const draft = unwrap(
      await saveExpenseDraft(f.deps, f.hanna.ctx, {
        waiver: false,
        positions: [
          { kind: 'trip', positionDate: '2026-05-10', tripKm: 84, amountCents: 1 },
          { kind: 'trip', positionDate: '2026-06-10', tripKm: 33 },
          { kind: 'trip', tripKm: 12 },
        ],
      }),
    );
    expect(draft.positions.map((p) => [p.amountCents, p.tripRateCentsPerKm])).toEqual([[2520, 30], [1155, 35], [0, null]]);
    expect(draft.totalCents).toBe(3675);
  });

  it('keeps the trip amount of the submission when the rate changes later', async () => {
    const f = await expenseFixture();
    const claim = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id }));
    expect(claim.positions[1]).toMatchObject({ kind: 'trip', amountCents: 2520, tripRateCentsPerKm: 30 });

    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'mileageRate', validFrom: '2026-01-01', value: 40 }));
    const later = unwrap(await getExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }));
    expect(later.positions[1]).toMatchObject({ amountCents: 2520, tripRateCentsPerKm: 30 });
    expect(later.totalCents).toBe(1999 + 2520);
  });

  it('refuses a stale autosave and returns the current version', async () => {
    const f = await expenseFixture();
    const v1 = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, positions: [{ kind: 'receipt', purpose: 'erster Stand' }] }));
    // Die Uhr steht still — die Version wechselt trotzdem mit jedem Speichern.
    const v2 = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { id: v1.id, expectedVersion: v1.version, waiver: false, positions: [{ id: v1.positions[0]!.id, kind: 'receipt', purpose: 'neuer Stand' }] }));
    expect(v2.version).not.toBe(v1.version);

    const stale = await saveExpenseDraft(f.deps, f.hanna.ctx, { id: v1.id, expectedVersion: v1.version, waiver: false, positions: [{ id: v1.positions[0]!.id, kind: 'receipt', purpose: 'alter Stand' }] });
    expect(err(stale)).toMatchObject({ type: 'conflict', code: 'staleVersion' });
    const current = unwrap(await getExpenseClaim(f.deps, f.hanna.ctx, { id: v1.id }));
    expect(current.version).toBe(v2.version);
    expect(current.positions[0]!.purpose).toBe('neuer Stand');
  });

  it('replaces the positions as a whole, keeping the receipt of a position that stays', async () => {
    const f = await expenseFixture();
    const draft = await readyDraft(f);
    const [receipt] = draft.positions;
    const saved = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { id: draft.id, expectedVersion: draft.version, waiver: false, iban: IBAN, positions: [{ id: receipt!.id, kind: 'receipt', positionDate: '2026-08-20', amountCents: 2100, purpose: 'Futter' }] }));
    expect(saved.positions).toHaveLength(1);
    expect(saved.positions[0]).toMatchObject({ id: receipt!.id, amountCents: 2100, documentId: receipt!.documentId, documentNumber: receipt!.documentNumber });
    expect(f.deps.db.select().from(financeExpensePositions).all()).toHaveLength(1);
  });

  it('refuses a waiver while waivers are switched off', async () => {
    const f = await expenseFixture();
    expect(err(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: true, positions: [] }))).toMatchObject({ code: 'expenseWaiversDisabled' });
    enableWaivers(f);
    expect(unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: true, recurring: true, positions: [] }))).toMatchObject({ waiver: true, recurring: true });
  });
});

describe('uploadExpenseReceipt', () => {
  it('files a pdf receipt in the name of the claim without any dms permission, refuses a photo and an oversized file naming the file', async () => {
    const f = await expenseFixture();
    const draft = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, positions: [{ kind: 'trip' }, { kind: 'receipt', positionDate: '2026-08-20' }] }));
    const positionId = draft.positions[1]!.id;

    const withReceipt = unwrap(await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, positionId, bytes: f.pdf(), fileName: 'rechnung.pdf' }));
    const position = withReceipt.positions[1]!;
    expect(position.documentId).toBeTruthy();
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, position.documentId!)).get()!;
    expect(doc).toMatchObject({ typeKey: 'voucher-invoice', direction: 'incoming', documentDate: '2026-08-20', subject: `Beleg zu Auslage ${draft.id} · Position 2`, number: position.documentNumber });
    expect(doc.subject).not.toContain('Hanna');
    expect(f.deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, doc.id)).all()).toEqual([expect.objectContaining({ entityType: 'financeExpenseClaim', entityId: draft.id })]);

    // Ersetzen: die Position zeigt auf das neue Dokument, der alte Bezug bleibt in der Akte.
    const replaced = unwrap(await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, positionId, bytes: f.pdf(), fileName: 'rechnung-2.pdf' }));
    expect(replaced.positions[1]!.documentId).not.toBe(doc.id);
    expect(f.deps.db.select().from(documentLinks).where(eq(documentLinks.entityId, draft.id)).all()).toHaveLength(2);

    const photo = await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, positionId, bytes: jpegBytes(), fileName: 'IMG_0042.jpg' });
    expect(err(photo)).toMatchObject({ code: 'expenseFileNotPdf', message: expect.stringMatching(/IMG_0042\.jpg.*Ihre Eingaben bleiben stehen/) });
    const big = new Uint8Array(DOCUMENT_MAX_BYTES + 1);
    big.set(f.pdf());
    const tooLarge = await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, positionId, bytes: big, fileName: 'scan.pdf' });
    expect(err(tooLarge)).toMatchObject({ code: 'expenseFileTooLarge', message: expect.stringMatching(/scan\.pdf.*10 MB/) });
    expect(f.deps.db.select().from(documents).all()).toHaveLength(2);

    // Eine Fahrt hat keinen Beleg, ein fremder Antrag nimmt keinen an.
    expect(err(await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: f.pdf(), fileName: 'x.pdf' }))).toMatchObject({ type: 'validation' });
    expect(err(await uploadExpenseReceipt(f.deps, f.otto.ctx, { claimId: draft.id, positionId, bytes: f.pdf(), fileName: 'x.pdf' }))).toMatchObject({ code: 'expenseNotOwner' });
  });

  it('prefers voucher-invoice and otherwise takes the first voucher type', async () => {
    const f = await expenseFixture();
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.voucherTypes', ['voucher-receipt', 'voucher-own'], 'test'));
    const draft = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, positions: [{ kind: 'receipt' }] }));
    const saved = unwrap(await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: f.pdf(), fileName: 'bon.pdf' }));
    expect(f.deps.db.select().from(documents).where(eq(documents.id, saved.positions[0]!.documentId!)).get()!.typeKey).toBe('voucher-receipt');
  });
});

describe('expenseFormStart', () => {
  it('starts the form for the own contact: name, the rate steps, whether waivers are offered — and refuses without a contact link', async () => {
    const f = await expenseFixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'mileageRate', validFrom: '2026-06-01', value: 35 }));
    const start = unwrap(await expenseFormStart(f.deps, f.hanna.ctx, {}));
    expect(start).toEqual({
      contactName: 'Hanna Helferin',
      iban: null,
      waiversEnabled: false,
      mileageRates: [
        { validFrom: '2026-01-01', centsPerKm: 30 },
        { validFrom: '2026-06-01', centsPerKm: 35 },
      ],
    });
    enableWaivers(f);
    expect(unwrap(await expenseFormStart(f.deps, f.hanna.ctx, {})).waiversEnabled).toBe(true);

    const refused = await expenseFormStart(f.deps, f.unlinked, {});
    expect(err(refused)).toMatchObject({ type: 'conflict', code: 'expenseNeedsContactLink', message: expect.stringContaining('Vera Verwalterin') });
    expect(err(await expenseFormStart(f.deps, ctxWith(['finance.read'], f.hanna.userId), {}))).toMatchObject({ type: 'forbidden', permission: 'finance.expensesSubmit' });
    expect(err(await expenseFormStart(f.deps, f.hanna.ctx, { unexpected: true }))).toMatchObject({ type: 'validation' });
  });

  it('prefills the iban from the latest own claim, else from a known bank account of the contact — never from someone else', async () => {
    const f = await expenseFixture();
    f.deps.db.insert(financeContactBankAccounts).values({ id: 'cba-1', contactId: f.hanna.contactId, iban: 'DE93999999990000000001', createdAt: '2026-02-01T00:00:00.000Z', createdByUserId: f.userId }).run();
    expect(unwrap(await expenseFormStart(f.deps, f.hanna.ctx, {})).iban).toBe('DE93999999990000000001');

    unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, iban: IBAN, positions: [] }));
    expect(unwrap(await expenseFormStart(f.deps, f.hanna.ctx, {})).iban).toBe(IBAN);
    expect(unwrap(await expenseFormStart(f.deps, f.otto.ctx, {})).iban).toBeNull();
  });
});

describe('readExpenseReceipt', () => {
  it('lets the owner read her own receipt without finance.read, and nobody else without it', async () => {
    const f = await expenseFixture();
    const draft = await readyDraft(f);
    const documentId = draft.positions[0]!.documentId!;

    const own = unwrap(await readExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, documentId }));
    expect(own.bytes).toEqual(f.pdf());
    expect(own.filename).toBe(`${draft.positions[0]!.documentNumber}.pdf`);

    expect(err(await readExpenseReceipt(f.deps, f.otto.ctx, { claimId: draft.id, documentId }))).toMatchObject({ type: 'forbidden', permission: 'finance.read' });
    expect(err(await readExpenseReceipt(f.deps, ctxWith([], f.hanna.userId), { claimId: draft.id, documentId }))).toMatchObject({ type: 'forbidden' });
    expect(unwrap(await readExpenseReceipt(f.deps, ctxWith(['finance.read'], f.secondPersonId), { claimId: draft.id, documentId })).bytes).toEqual(f.pdf());

    // Nur Dokumente dieses Antrags — ein Beleg eines anderen Antrags ist hier unbekannt.
    const other = await readyDraft(f, f.otto);
    expect(err(await readExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, documentId: other.positions[0]!.documentId! }))).toMatchObject({ type: 'notFound' });
  });
});

describe('submitExpenseClaim', () => {
  it('submits with a number KE-year-nnn only when every receipt position has a document, trips have km, and iban or waiver is given', async () => {
    const f = await expenseFixture();
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, iban: IBAN, positions: [] })).id }))).toMatchObject({ code: 'expenseNothingToSubmit' });

    let draft = unwrap(
      await saveExpenseDraft(f.deps, f.hanna.ctx, {
        waiver: false,
        positions: [
          { kind: 'receipt', positionDate: '2026-08-20', amountCents: 1999, purpose: 'Futter' },
          { kind: 'trip', positionDate: '2026-08-21', tripReason: 'Tierarztfahrt' },
        ],
      }),
    );
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id }))).toMatchObject({ code: 'expensePositionNeedsReceipt', message: expect.stringContaining('Position 1') });
    draft = unwrap(await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: f.pdf(), fileName: 'rechnung.pdf' }));
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id }))).toMatchObject({ code: 'expenseTripNeedsKm' });

    const positions = draft.positions.map((p) => ({ id: p.id, kind: p.kind, positionDate: p.positionDate!, amountCents: p.amountCents, purpose: p.purpose, tripReason: p.tripReason ?? undefined, tripKm: p.kind === 'trip' ? 84 : undefined }));
    draft = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { id: draft.id, waiver: false, positions }));
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id }))).toMatchObject({ code: 'expenseIbanOrWaiver' });
    draft = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { id: draft.id, waiver: false, iban: 'DE00 1234 5678', positions }));
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id }))).toMatchObject({ code: 'expenseIbanOrWaiver' });
    draft = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { id: draft.id, waiver: false, iban: IBAN, positions }));

    const claim = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(claim).toMatchObject({ state: 'submitted', number: 'KE-2026-001', submittedAt: '2026-09-05T08:00:00.000Z', totalCents: 1999 + 2520, stateLabelKey: 'submitted' });
    expect(unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id })).number).toBe('KE-2026-002');
    // Die Nummer zählt je Jahr des Einreichens.
    f.deps.clock.set('2027-01-04T09:00:00.000Z');
    expect(unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id })).number).toBe('KE-2027-001');

    // Die Kontaktrolle `claimant` läuft ab dem ersten Einreichen — einmal.
    expect(f.deps.db.select().from(contactRoles).where(and(eq(contactRoles.contactId, f.hanna.contactId), eq(contactRoles.role, 'claimant'), isNull(contactRoles.until))).all()).toHaveLength(1);
  });

  it('submits a waiver without iban while waivers are switched on, and never while they are off', async () => {
    const f = await expenseFixture();
    enableWaivers(f);
    const waived = await readyDraft(f, f.hanna, { iban: null, waiver: true });
    enableWaivers(f, false);
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: waived.id }))).toMatchObject({ code: 'expenseWaiversDisabled' });
    enableWaivers(f);
    expect(unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: waived.id }))).toMatchObject({ state: 'submitted', waiver: true, iban: null });
  });

  it('copies the basis of the waiver onto the claim when it is submitted: the terms of the person, else the setting', async () => {
    const f = await expenseFixture();
    enableWaivers(f);
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiverBasisText', 'Satzung § 7 Abs. 2', 'test'));
    const general = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f, f.hanna, { iban: null, waiver: true })).id }));
    expect(general).toMatchObject({ waiverBasisText: 'Satzung § 7 Abs. 2', waiverAgreedOn: null });
    const plain = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id }));
    expect(plain).toMatchObject({ waiver: false, waiverBasisText: null });
    f.deps.db.insert(financeContactWaiverTerms).values({ id: 'TERMS-OTTO', contactId: f.otto.contactId, basisText: 'Vereinbarung vom 02.01.2026', agreedOn: '2026-01-02', updatedAt: '2026-01-02T10:00:00.000Z', updatedByUserId: f.userId }).run();
    const own = unwrap(await submitExpenseClaim(f.deps, f.otto.ctx, { id: (await readyDraft(f, f.otto, { iban: null, waiver: true })).id }));
    expect(own).toMatchObject({ waiverBasisText: 'Vereinbarung vom 02.01.2026', waiverAgreedOn: '2026-01-02' });
  });

  it('is immutable after submission except the approval fields (trigger)', async () => {
    const f = await expenseFixture();
    const claim = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id }));
    const positionId = claim.positions[0]!.id;

    expect(err(await saveExpenseDraft(f.deps, f.hanna.ctx, { id: claim.id, waiver: false, positions: [] }))).toMatchObject({ code: 'expenseNotDraft' });
    expect(err(await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: claim.id, positionId, bytes: f.pdf(), fileName: 'x.pdf' }))).toMatchObject({ code: 'expenseNotDraft' });
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }))).toMatchObject({ code: 'expenseNotDraft' });
    expect(err(await deleteExpenseDraft(f.deps, f.hanna.ctx, { id: claim.id }))).toMatchObject({ code: 'expenseNotDraft' });

    // Am Dienst vorbei: der Trigger hält, was eingereicht wurde; die Freigabefelder bleiben offen.
    expect(() => f.deps.db.update(financeExpenseClaims).set({ iban: 'DE23999999990000202051' }).where(eq(financeExpenseClaims.id, claim.id)).run()).toThrow(/permanent/);
    expect(() => f.deps.db.update(financeExpensePositions).set({ amountCents: 1 }).where(eq(financeExpensePositions.id, positionId)).run()).toThrow(/permanent/);
    f.deps.db.update(financeExpensePositions).set({ categoryId: f.programCosts.id }).where(eq(financeExpensePositions.id, positionId)).run();
    f.deps.db.update(financeExpenseClaims).set({ state: 'approved', approvedAt: '2026-09-06T10:00:00.000Z', approvedByUserId: f.secondPersonId }).where(eq(financeExpenseClaims.id, claim.id)).run();
    expect(unwrap(await getExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }))).toMatchObject({ state: 'approved', stateLabelKey: 'approved', paid: null });
  });
});

describe('listMyExpenseClaims and getExpenseClaim', () => {
  it('lists only the own claims and derives paid from the open item', async () => {
    const f = await expenseFixture();
    const draft = await readyDraft(f);
    const claim = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id }));
    await readyDraft(f, f.otto);

    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-09-05', contactId: f.hanna.contactId, amountCents: claim.totalCents, originType: 'financeExpenseClaim', originId: claim.id, paymentReference: claim.number }));
    f.deps.db.update(financeExpenseClaims).set({ state: 'approved', approvedAt: '2026-09-05T09:00:00.000Z', approvedByUserId: f.secondPersonId, openItemId: item.id }).where(eq(financeExpenseClaims.id, claim.id)).run();

    const mine = unwrap(await listMyExpenseClaims(f.deps, f.hanna.ctx, {}));
    expect(mine.total).toBe(2);
    expect(mine.items.map((c) => c.id).sort()).toEqual([draft.id, claim.id].sort());
    expect(mine.items.find((c) => c.id === claim.id)).toMatchObject({ stateLabelKey: 'approved', paid: { settledCents: 0, paidOn: null, state: 'unpaid' } });
    expect(unwrap(await listMyExpenseClaims(f.deps, f.otto.ctx, {})).items.map((c) => c.contactId)).toEqual([f.otto.contactId]);

    const pay = (date: string, cents: number) => bookEntry(f.deps, f.ctx, { entryDate: date, text: `Erstattung ${claim.number}`, moneyLines: [{ accountId: f.bank.id, amountCents: -cents, settlements: [{ openItemId: item.id, amountCents: cents }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -cents }] }).then(unwrap);
    await pay('2026-09-01', 1000);
    expect(unwrap(await getExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }))).toMatchObject({ stateLabelKey: 'approved', paid: { settledCents: 1000, paidOn: '2026-09-01', state: 'partly' } });
    await pay('2026-09-04', claim.totalCents - 1000);
    const paid = unwrap(await getExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }));
    expect(paid).toMatchObject({ stateLabelKey: 'paid', paid: { settledCents: claim.totalCents, paidOn: '2026-09-04', state: 'paid' } });

    expect(unwrap(await listMyExpenseClaims(f.deps, f.hanna.ctx, { state: 'open' })).items.map((c) => c.id)).toEqual([draft.id]);
    expect(unwrap(await listMyExpenseClaims(f.deps, f.hanna.ctx, { state: 'done' })).items.map((c) => c.id)).toEqual([claim.id]);
    expect(unwrap(await listMyExpenseClaims(f.deps, f.hanna.ctx, { limit: 1, offset: 1 }))).toMatchObject({ total: 2, items: [expect.anything()] });

    // Fremde Anträge: nur mit finance.read, dann mit voller IBAN.
    expect(err(await getExpenseClaim(f.deps, f.otto.ctx, { id: claim.id }))).toMatchObject({ code: 'expenseNotOwner' });
    expect(unwrap(await getExpenseClaim(f.deps, ctxWith(['finance.read'], f.secondPersonId), { id: claim.id }))).toMatchObject({ iban: IBAN, contactName: 'Hanna Helferin' });
    expect(err(await listMyExpenseClaims(f.deps, f.unlinked, {}))).toMatchObject({ code: 'expenseNeedsContactLink' });
  });

  it('names who can approve, without the person who created the claim and without the claimant', async () => {
    const f = await expenseFixture();
    const roleId = f.deps.db.select().from(schema.roles).all().find((r) => r.name === 'Verwaltung')!.id;
    f.deps.db.insert(schema.rolePermissions).values({ roleId, permissionKey: 'finance.approve' }).run();
    f.deps.db.insert(schema.userRoles).values({ userId: f.hanna.userId, roleId }).run();
    const claim = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id }));
    expect(claim.approverNames).toEqual(['Vera Verwalterin']);
  });
});

describe('copyExpenseClaim', () => {
  it('copies a rejected claim as a draft with a reference and relinked receipts', async () => {
    const f = await expenseFixture();
    const claim = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id }));
    expect(err(await copyExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }))).toMatchObject({ code: 'expenseNotRejected' });
    f.deps.db.update(financeExpensePositions).set({ categoryId: f.programCosts.id }).where(eq(financeExpensePositions.claimId, claim.id)).run();
    f.deps.db.update(financeExpenseClaims).set({ state: 'rejected', rejectedAt: '2026-09-06T10:00:00.000Z', rejectedByUserId: f.secondPersonId, rejectNote: 'Beleg unleserlich' }).where(eq(financeExpenseClaims.id, claim.id)).run();

    expect(err(await copyExpenseClaim(f.deps, f.otto.ctx, { id: claim.id }))).toMatchObject({ code: 'expenseNotOwner' });
    const copy = unwrap(await copyExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }));
    expect(copy).toMatchObject({ state: 'draft', number: null, copiedFromClaimId: claim.id, iban: IBAN, waiver: false, rejectNote: null, totalCents: claim.totalCents });
    expect(copy.id).not.toBe(claim.id);
    expect(copy.positions.map((p) => [p.kind, p.documentId, p.documentNumber, p.amountCents, p.categoryId])).toEqual(claim.positions.map((p) => [p.kind, p.documentId, p.documentNumber, p.amountCents, null]));
    expect(copy.positions.map((p) => p.id)).not.toEqual(claim.positions.map((p) => p.id));
    // Dieselben Dokumente, neue Bezüge: die Kopie liest ihren Beleg über sich selbst.
    const documentId = copy.positions[0]!.documentId!;
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, documentId), eq(documentLinks.entityId, copy.id))).all()).toHaveLength(1);
    expect(unwrap(await readExpenseReceipt(f.deps, f.hanna.ctx, { claimId: copy.id, documentId })).bytes).toEqual(f.pdf());
    // Die Kopie ist wieder einreichbar.
    expect(unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: copy.id })).number).toBe('KE-2026-002');
  });

  it('drops the waiver from the copy while waivers are switched off', async () => {
    const f = await expenseFixture();
    enableWaivers(f);
    const claim = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f, f.hanna, { iban: null, waiver: true })).id }));
    f.deps.db.update(financeExpenseClaims).set({ state: 'rejected', rejectedAt: '2026-09-06T10:00:00.000Z', rejectedByUserId: f.secondPersonId }).where(eq(financeExpenseClaims.id, claim.id)).run();
    enableWaivers(f, false);
    expect(unwrap(await copyExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }))).toMatchObject({ waiver: false, waiverBasisText: null });
  });
});

describe('deleteExpenseDraft', () => {
  it('deletes the own draft with its positions and refuses a foreign one', async () => {
    const f = await expenseFixture();
    const draft = await readyDraft(f);
    expect(err(await deleteExpenseDraft(f.deps, f.otto.ctx, { id: draft.id }))).toMatchObject({ code: 'expenseNotOwner' });
    unwrap(await deleteExpenseDraft(f.deps, f.hanna.ctx, { id: draft.id }));
    expect(f.deps.db.select().from(financeExpenseClaims).all()).toEqual([]);
    expect(f.deps.db.select().from(financeExpensePositions).all()).toEqual([]);
    // Der Beleg bleibt in der Akte, sein Bezug auf den verschwundenen Entwurf nicht.
    expect(f.deps.db.select().from(documents).all()).toHaveLength(1);
    expect(f.deps.db.select().from(documentLinks).where(eq(documentLinks.entityId, draft.id)).all()).toEqual([]);
    expect(JSON.parse(auditEntry(f.deps, 'finance.expenseClaim.draftDelete').before as string)).toEqual({ state: 'draft', positionCount: 2, totalCents: 1999 + 2520 });
  });
  it('a deleted contact takes the document links of its drafts along, the receipts stay', async () => {
    const f = await expenseFixture();
    const draft = await readyDraft(f);
    f.deps.db.transaction((tx) => financeRecordDeleted(tx, f.deps, f.ctx, 'contact', f.hanna.contactId));
    expect(f.deps.db.select().from(financeExpenseClaims).all()).toEqual([]);
    expect(f.deps.db.select().from(documents).all()).toHaveLength(1);
    expect(f.deps.db.select().from(documentLinks).where(eq(documentLinks.entityId, draft.id)).all()).toEqual([]);
  });
});

describe('forbidden, validation, audit', () => {
  it('forbidden/validation/audit without iban, purpose or contact', async () => {
    const f = await expenseFixture();
    const nobody = ctxWith(['finance.read'], f.hanna.userId);
    for (const call of [
      saveExpenseDraft(f.deps, nobody, { waiver: false, positions: [] }),
      uploadExpenseReceipt(f.deps, nobody, { claimId: 'X', positionId: 'Y', bytes: f.pdf(), fileName: 'x.pdf' }),
      submitExpenseClaim(f.deps, nobody, { id: 'X' }),
      deleteExpenseDraft(f.deps, nobody, { id: 'X' }),
      copyExpenseClaim(f.deps, nobody, { id: 'X' }),
      listMyExpenseClaims(f.deps, nobody, {}),
    ]) {
      expect(err(await call)).toMatchObject({ type: 'forbidden', permission: 'finance.expensesSubmit' });
    }
    expect(err(await getExpenseClaim(f.deps, ctxWith([], f.hanna.userId), { id: 'X' }))).toMatchObject({ type: 'forbidden' });

    expect(err(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, positions: [{ kind: 'photo' }] }))).toMatchObject({ type: 'validation' });
    expect(err(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, positions: [{ kind: 'trip', tripKm: -3 }] }))).toMatchObject({ type: 'validation' });
    expect(err(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, positions: [{ kind: 'receipt', amountCents: -5 }] }))).toMatchObject({ type: 'validation' });

    // Einreichen ohne „Wofür“ oder Datum: am Feld.
    const noPurpose = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { waiver: false, iban: IBAN, positions: [{ kind: 'receipt', amountCents: 500 }] }));
    unwrap(await uploadExpenseReceipt(f.deps, f.hanna.ctx, { claimId: noPurpose.id, positionId: noPurpose.positions[0]!.id, bytes: f.pdf(), fileName: 'x.pdf' }));
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: noPurpose.id }))).toMatchObject({
      type: 'validation',
      issues: expect.arrayContaining([{ path: 'positions.0.purpose', message: 'required' }, { path: 'positions.0.positionDate', message: 'required' }]),
    });

    // Das Protokoll: Zustand, Nummer, Zähler, Beträge — nie IBAN, Kontakt, „Wofür“, Strecke, Anlass.
    const claim = unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: (await readyDraft(f)).id }));
    expect(JSON.parse(auditEntry(f.deps, 'finance.expenseClaim.saveDraft').after as string)).toEqual({ state: 'draft', positionCount: 2, totalCents: 1999 + 2520, waiver: false, recurring: false });
    expect(JSON.parse(auditEntry(f.deps, 'finance.expenseClaim.submit').after as string)).toEqual({ state: 'submitted', number: claim.number, positionCount: 2, totalCents: 1999 + 2520, waiver: false, recurring: false, submittedAt: claim.submittedAt });
    expect(JSON.parse(auditEntry(f.deps, 'finance.expensePosition.receipt').after as string)).toEqual({ claimId: claim.id, documentId: claim.positions[0]!.documentId });
    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action.startsWith('finance.')));
    for (const secret of [IBAN, f.hanna.contactId, 'Futter', 'Musterstadt', 'Tierarztfahrt', 'Hanna']) expect(log, secret).not.toContain(secret);
  });
});
