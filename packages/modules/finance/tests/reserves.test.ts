import { defineModule, isModuleEnabled, unwrap } from '@kompass/core';
import { schema } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documents, documentTypes } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteReserve, freeReserveCap, freeReserveCapInternal, freeReserveCapOverview, linkResolution, listReserves, recordReserveCarryForward, recordReserveMovement, saveReserve, setReserveActive, uploadResolution } from '../src/allocation/reserves';
import { requestPurposeTransfer } from '../src/allocation/transfers';
import { registerResolutionFactsSource, type ResolutionFacts } from '../src/sources';
import { setDatedValue } from '../src/ledger/dated-values';
import { reopenFiscalYear } from '../src/ledger/period';
import { bookEntry } from '../src/ledger/finalize';
import { incomeStatement } from '../src/ledger/queries';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { ULID_PATTERN } from '../src/allocation/subjects';
import { RESERVE_KINDS } from '../src/allocation/reserve-rules';
import { financeAllocationLines, financeCategories, financeEntries, financeReserveMovements, financeReserves } from '../src/schema';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';
import { jpegBytes } from './expense-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/** Ein Dokument der Akte pickt nur, wer `dms.view` hat — wie in `notices.test.ts`. */
const withDms = (f: Awaited<ReturnType<typeof ledgerFixture>>) => ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);

describe('saveReserve, setReserveActive, deleteReserve, listReserves (F8b Task 2, Annahme 1)', () => {
  it('requires a resolution document for the reserve — refused without one, accepted with one', async () => {
    const f = await ledgerFixture();
    const noDoc = await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage' });
    expect(err(noDoc)).toMatchObject({ code: 'reserveResolutionRequired' });

    const docId = insertDocument(f, { subject: 'Protokoll Vorstand', typeKey: 'minutes' });
    const created = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    expect(created).toMatchObject({ kind: 'free', resolutionDocumentId: docId, balanceCents: 0, isDissolved: false });
  });

  it('picking a document needs dms.view, even with finance.setup', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const denied = await saveReserve(f.deps, f.ctx, { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId });
    expect(err(denied)).toMatchObject({ type: 'forbidden', permission: 'dms.view' });
  });

  it('requires the purpose text for projectFunds and replacement, but not for free or participation', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const missing = await saveReserve(f.deps, withDms(f), { kind: 'projectFunds', name: 'Projektmittel', resolutionDocumentId: docId });
    expect(err(missing)).toMatchObject({ code: 'reservePurposeTextRequired' });
    const ok1 = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'projectFunds', name: 'Projektmittel', purposeText: 'Für das neue Vereinsheim', resolutionDocumentId: docId }));
    expect(ok1.purposeText).toBe('Für das neue Vereinsheim');
    const ok2 = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    expect(ok2.purposeText).toBeNull();
  });

  it('needs all three carry-forward fields together, or none', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const incomplete = await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', carryForwardCents: 1000, resolutionDocumentId: docId });
    expect(err(incomplete)).toMatchObject({ code: 'reserveCarryForwardIncomplete' });
    // Teil C Task 2: den Vortrag setzt nur `recordReserveCarryForward`, zusammen mit seinem Beschluss.
    const viaSave = await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', carryForwardCents: 1000, carryForwardDate: '2026-01-01', resolutionDocumentId: docId });
    expect(err(viaSave)).toMatchObject({ code: 'reserveCarryForwardOwnStep' });
  });

  it('refuses when the minutes document type is inactive, and names who can enable it', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    f.deps.db.update(documentTypes).set({ isActive: false }).where(eq(documentTypes.key, 'minutes')).run();
    const result = await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId });
    expect(err(result)).toMatchObject({ code: 'resolutionTypeInactive' });
  });

  it('links or replaces the resolution afterwards, activates/deactivates, and deletes only unused', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const otherDocId = insertDocument(f, { subject: 'Anderes Protokoll', typeKey: 'minutes' });
    const relinked = unwrap(await linkResolution(f.deps, withDms(f), { id: reserve.id, field: 'resolution', documentId: otherDocId }));
    expect(relinked.resolutionDocumentId).toBe(otherDocId);

    const deactivated = unwrap(await setReserveActive(f.deps, f.ctx, { id: reserve.id, isActive: false, expectedVersion: relinked.updatedAt }));
    expect(deactivated.isActive).toBe(false);

    const deleted = await deleteReserve(f.deps, f.ctx, { id: reserve.id });
    expect(deleted.ok).toBe(true);

    const another = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Zweite freie Rücklage', resolutionDocumentId: docId }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: another.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId }));
    const usedDelete = await deleteReserve(f.deps, f.ctx, { id: another.id });
    expect(err(usedDelete)).toMatchObject({ code: 'reserveInUse' });
  });

  it('lists reserves with their computed balance', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId }));
    const list = unwrap(await listReserves(f.deps, f.ctx));
    expect(list.find((r) => r.id === reserve.id)?.balanceCents).toBe(5000);
  });

  it('creates a reserve with an uploaded resolution instead of a picked one — never both', async () => {
    const f = await ledgerFixture();
    const both = await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'X', resolutionDocumentId: 'DOC-1', resolutionUpload: { bytes: pdfBytes(), fileName: 'protokoll.pdf' } });
    expect(err(both)).toMatchObject({ type: 'validation' });

    const created = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionUpload: { bytes: pdfBytes(), fileName: 'protokoll.pdf' } }));
    expect(created.resolutionDocumentId).not.toBeNull();
    const stored = f.deps.db.select().from(financeReserves).where(eq(financeReserves.id, created.id)).get()!;
    expect(stored.resolutionDocumentId).toBe(created.resolutionDocumentId);
  });

  it('refuses an uploaded resolution that is not a PDF or too large', async () => {
    const f = await ledgerFixture();
    const notPdf = await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'X', resolutionUpload: { bytes: jpegBytes(), fileName: 'foto.jpg' } });
    expect(err(notPdf)).toMatchObject({ code: 'resolutionFileNotPdf' });
    const tooBig = await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'X', resolutionUpload: { bytes: new Uint8Array([...pdfBytes(), ...new Uint8Array(11 * 1024 * 1024)]), fileName: 'groß.pdf' } });
    expect(err(tooBig)).toMatchObject({ code: 'resolutionFileTooLarge' });
  });

  it('links or uploads a resolution after creation via linkResolution/uploadResolution', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const uploaded = unwrap(await uploadResolution(f.deps, withDms(f), { id: reserve.id, field: 'resolution', bytes: pdfBytes(), fileName: 'neu.pdf' }));
    expect(uploaded.resolutionDocumentId).not.toBe(docId);
  });
});

describe('recordReserveCarryForward — Vortrag und Beschluss in einem Schritt (Design-Nachtrag Phase 4, Teil C Task 2)', () => {
  async function reserveWith(f: Awaited<ReturnType<typeof ledgerFixture>>) {
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    return unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
  }

  it('sets amount, date and a picked resolution together, with one audit entry', async () => {
    const f = await ledgerFixture();
    const reserve = await reserveWith(f);
    const carryDoc = insertDocument(f, { subject: 'Protokoll Vortrag', typeKey: 'minutes' });
    const saved = unwrap(await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 1000, carryForwardDate: '2026-01-01', documentId: carryDoc }));
    expect(saved).toMatchObject({ carryForwardCents: 1000, carryForwardDate: '2026-01-01', carryForwardDocumentId: carryDoc });
    const audits = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.reserve.carryForward');
    expect(audits).toHaveLength(1);
  });

  it('uploads the resolution in the same step', async () => {
    const f = await ledgerFixture();
    const reserve = await reserveWith(f);
    const saved = unwrap(await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 2500, carryForwardDate: '2026-01-01', upload: { bytes: pdfBytes(), fileName: 'vortrag.pdf' } }));
    expect(saved.carryForwardCents).toBe(2500);
    expect(saved.carryForwardDocumentId).not.toBeNull();
  });

  it('refuses without a resolution, and leaves nothing behind when the resolution fails', async () => {
    const f = await ledgerFixture();
    const reserve = await reserveWith(f);
    const none = await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 1000, carryForwardDate: '2026-01-01' });
    expect(err(none)).toMatchObject({ code: 'reserveCarryForwardIncomplete' });
    const notPdf = await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 1000, carryForwardDate: '2026-01-01', upload: { bytes: jpegBytes(), fileName: 'foto.jpg' } });
    expect(err(notPdf)).toMatchObject({ code: 'resolutionFileNotPdf' });
    const voided = insertDocument(f, { subject: 'Widerrufen', typeKey: 'minutes', voided: true });
    const badPick = await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 1000, carryForwardDate: '2026-01-01', documentId: voided });
    expect(badPick.ok).toBe(false);
    expect(f.deps.db.select().from(financeReserves).where(eq(financeReserves.id, reserve.id)).get()).toMatchObject({ carryForwardCents: null, carryForwardDate: null, carryForwardDocumentId: null });
  });

  it('changes the amount later and keeps the resolution already filed', async () => {
    const f = await ledgerFixture();
    const reserve = await reserveWith(f);
    const carryDoc = insertDocument(f, { subject: 'Protokoll Vortrag', typeKey: 'minutes' });
    const first = unwrap(await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 1000, carryForwardDate: '2026-01-01', documentId: carryDoc }));
    const second = unwrap(await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: first.updatedAt, carryForwardCents: 1200, carryForwardDate: '2026-01-01' }));
    expect(second).toMatchObject({ carryForwardCents: 1200, carryForwardDocumentId: carryDoc });
  });

  it('needs finance.setup, refuses a stale version, and saveReserve still passes an unchanged carry-forward through', async () => {
    const f = await ledgerFixture();
    const reserve = await reserveWith(f);
    const carryDoc = insertDocument(f, { subject: 'Protokoll Vortrag', typeKey: 'minutes' });
    const input = { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 1000, carryForwardDate: '2026-01-01', documentId: carryDoc };
    expect(err(await recordReserveCarryForward(f.deps, ctxWith(['finance.read', 'dms.view'], f.userId), input))).toMatchObject({ type: 'forbidden' });
    expect(err(await recordReserveCarryForward(f.deps, withDms(f), { ...input, carryForwardCents: -5 }))).toMatchObject({ type: 'validation' });
    const saved = unwrap(await recordReserveCarryForward(f.deps, withDms(f), input));
    expect(err(await recordReserveCarryForward(f.deps, withDms(f), input))).toMatchObject({ code: 'staleVersion' });
    const renamed = unwrap(await saveReserve(f.deps, withDms(f), { id: reserve.id, expectedVersion: saved.updatedAt, kind: 'free', name: 'Umbenannt', carryForwardCents: 1000, carryForwardDate: '2026-01-01' }));
    expect(renamed).toMatchObject({ name: 'Umbenannt', carryForwardCents: 1000, carryForwardDocumentId: carryDoc });
  });
});

describe('recordReserveMovement (F8b Task 2, Annahme 2, Prüfstein 8)', () => {
  it('records a movement with an uploaded resolution instead of a picked one', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const movement = unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionUpload: { bytes: pdfBytes(), fileName: 'beschluss.pdf' } }));
    expect(movement.resolutionDocumentId).not.toBe(docId);
    expect(movement.balanceAfterCents).toBe(5000);
  });

  it('requires a resolution document for every movement', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const result = await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0' });
    expect(result.ok).toBe(false);
  });

  it('refuses a withdrawal above the balance and names the calculation', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId }));
    const result = await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'withdraw', movementDate: '2026-03-06', amountCents: 8000, resolutionDocumentId: docId });
    expect(err(result)).toMatchObject({ code: 'reserveInsufficient', params: expect.objectContaining({ date: '2026-03-06', available: 5000, amount: 8000 }) });
  });

  it('dissolves with the remainder as the stored amount, and refuses further movements', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId }));
    const dissolved = unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'dissolve', movementDate: '2026-03-10', resolutionDocumentId: docId }));
    expect(dissolved.amountCents).toBe(5000);
    expect(dissolved.balanceAfterCents).toBe(0);
    const again = await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-11', amountCents: 100, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId });
    expect(err(again)).toMatchObject({ code: 'reserveDissolved' });
  });

  it('refuses movements out of date order, in a closed year, or after today', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-10', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId }));
    const outOfOrder = await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-01', amountCents: 100, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId });
    expect(err(outOfOrder)).toMatchObject({ code: 'reserveMovementOutOfOrder' });

    f.closeYear(f.year.id);
    const closed = await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-11', amountCents: 100, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId });
    expect(err(closed)).toMatchObject({ code: 'fiscalYearClosed' });

    const future = await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2099-01-01', amountCents: 100, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId });
    expect(err(future)).toMatchObject({ code: 'movementDateInFuture' });
  });

  it('never touches a money account, a line, or the EÜR (Prüfstein 8)', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const entriesBefore = f.deps.db.select().from(financeEntries).all().length;
    const linesBefore = f.deps.db.select().from(financeAllocationLines).all().length;
    const statementBefore = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId }));
    expect(f.deps.db.select().from(financeEntries).all().length).toBe(entriesBefore);
    expect(f.deps.db.select().from(financeAllocationLines).all().length).toBe(linesBefore);
    expect(incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' })).toEqual(statementBefore);
    expect(f.deps.db.select().from(financeReserveMovements).all()).toHaveLength(1);
  });
});

describe('freeReserveCap (F8b Task 2, Annahme 4, § 62 Abs. 1 Nr. 3 AO — Näherung)', () => {
  it('computes the cap with the dated shares, and counts used allocations by the year they are for', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const zero = unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(zero.capCents).toBe(0);

    unwrap(await bookEntryDonation(f));
    const withDonation = unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(withDonation.otherTimelyFundsCents).toBeGreaterThan(0);
    expect(withDonation.capCents).toBe(Math.floor((withDonation.otherTimelyFundsCents * 10) / 100));

    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 1000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', forFiscalYearId: f.year.id, resolutionDocumentId: docId }));
    const used = unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(used.usedCents).toBe(1000);
  });

  it('treats a negative surplus of asset management as zero, and reads an exact third', async () => {
    const f = await ledgerFixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'freeReserveAssetShare', validFrom: '2026-01-01', value: '1/2' }));
    unwrap(await bookEntryDonation(f));
    const cap = unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(cap.assetManagementSurplusCents).toBe(0);
    expect(cap.capCents).toBe(Math.floor((cap.otherTimelyFundsCents * 10) / 100));

    // Überschuss der Vermögensverwaltung 100 € → ein Drittel ist 33,33 € (⌊10000/3⌋), nicht 33 €.
    const g = await ledgerFixture();
    const interest = g.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'interest')).get()!;
    unwrap(await bookEntry(g.deps, g.ctx, { entryDate: '2026-03-01', text: 'Zinsen', moneyLines: [{ accountId: g.bank.id, amountCents: 10000 }], allocationLines: [{ categoryId: interest.id, amountCents: 10000 }] }));
    const third = unwrap(await freeReserveCap(g.deps, g.ctx, { fiscalYearId: g.year.id }));
    expect(third.assetManagementSurplusCents).toBe(10000);
    expect(third.capCents).toBe(3333);
  });

  it('rechnet auch für Jahre vor 2026: ein Drittel und 10 % gelten seit 2000 (Designer Runde 7, 262)', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const y2025 = f.years['2025']!.id;
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 59850 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 59850 }] }));
    const cap = unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(cap.otherTimelyFundsCents).toBe(59850);
    expect(cap.capCents).toBe(5985);
  });
});

describe('freeReserveCapOverview (Befund 4, Fassung 0.2.7)', () => {
  it('shows the open previous year as provisional before the current one, and drops it once closed', async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'] });
    unwrap(await bookEntryDonation(f)); // 2026-03-01, gibt 2026 einen Höchstbetrag
    f.deps.clock.set('2027-02-10T10:00:00.000Z');

    const spring = unwrap(await freeReserveCapOverview(f.deps, f.ctx, {}));
    expect(spring.years.map((y) => [y.designation, y.provisional])).toEqual([['2026', true], ['2027', false]]);
    expect(spring.defaultFiscalYearId).toBe(f.years['2026']!.id);
    const cap2026 = unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: f.years['2026']!.id }));
    expect(spring.years[0]).toMatchObject({ fiscalYearId: f.years['2026']!.id, startsOn: '2026-01-01', endsOn: '2026-12-31', capCents: cap2026.capCents });
    expect(spring.years[0]!.capCents).toBeGreaterThan(0);
    expect(spring.years[1]).toMatchObject({ capCents: 0, usedCents: 0, exceeded: false });

    f.closeYear(f.years['2026']!.id);
    const closed = unwrap(await freeReserveCapOverview(f.deps, f.ctx, {}));
    expect(closed.years.map((y) => y.designation)).toEqual(['2027']);
    expect(closed.defaultFiscalYearId).toBe(f.years['2027']!.id);
  });

  it('brings a reopened previous year back, provisional again (Befund 7b) — the latest period event counts', async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'] });
    unwrap(await bookEntryDonation(f));
    f.deps.clock.set('2027-02-10T10:00:00.000Z');
    f.closeYear(f.years['2026']!.id);
    expect(unwrap(await freeReserveCapOverview(f.deps, f.ctx, {})).years.map((y) => y.designation)).toEqual(['2027']);

    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2026']!.id, note: 'Spende nachgetragen' }));
    const reopened = unwrap(await freeReserveCapOverview(f.deps, f.ctx, {}));
    expect(reopened.years.map((y) => [y.designation, y.provisional])).toEqual([['2026', true], ['2027', false]]);
    expect(reopened.defaultFiscalYearId).toBe(f.years['2026']!.id);
  });

  it('needs finance.overview or finance.read and takes no arguments', async () => {
    const f = await ledgerFixture();
    expect(err(await freeReserveCapOverview(f.deps, ctxWith([], f.userId), {}))).toMatchObject({ type: 'forbidden' });
    expect(unwrap(await freeReserveCapOverview(f.deps, ctxWith(['finance.overview'], f.userId), {})).years.map((y) => y.designation)).toEqual(['2026']);
    expect(err(await freeReserveCapOverview(f.deps, f.ctx, { fiscalYearId: 'x' }))).toMatchObject({ type: 'validation' });
  });

  it('refuses an allocation to a free reserve without a year while two years are in question, and names both', async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'] });
    f.deps.clock.set('2027-02-12T10:00:00.000Z');
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const allocate = { reserveId: reserve.id, kind: 'allocate', amountCents: 100, capReason: 'Test: ohne Einnahmen ist der Höchstbetrag 0', resolutionDocumentId: docId };

    // Ohne Jahr bei offenem Vorjahr: Ablehnung mit beiden Jahren, nichts gespeichert.
    const refused = await recordReserveMovement(f.deps, withDms(f), { ...allocate, movementDate: '2027-02-10' });
    expect(err(refused)).toMatchObject({ type: 'conflict', code: 'reserveYearAmbiguous', params: { previous: '2026', current: '2027' } });
    expect(f.deps.db.select().from(financeReserveMovements).all()).toHaveLength(0);

    // Mit Jahr: wie angegeben — das Vorjahr wie das laufende.
    const forPrevious = unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, movementDate: '2027-02-10', forFiscalYearId: f.years['2026']!.id }));
    expect(forPrevious.forFiscalYearId).toBe(f.years['2026']!.id);
    const forCurrent = unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, movementDate: '2027-02-11', forFiscalYearId: f.years['2027']!.id }));
    expect(forCurrent.forFiscalYearId).toBe(f.years['2027']!.id);

    // Entnahmen tragen kein Jahr und fragen nicht.
    const withdrawn = unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'withdraw', movementDate: '2027-02-11', amountCents: 50, resolutionDocumentId: docId }));
    expect(withdrawn.forFiscalYearId).toBeNull();

    // Ohne Jahr bei abgeschlossenem Vorjahr: das laufende Jahr, ohne Rückfrage.
    f.closeYear(f.years['2026']!.id);
    const later = unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, movementDate: '2027-02-12' }));
    expect(later.forFiscalYearId).toBe(f.years['2027']!.id);
  });

  it('F-B1: refuses an allocation for a year that does not count on the movement date — closed previous year, foreign year', async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'] });
    f.deps.clock.set('2027-02-12T10:00:00.000Z');
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const allocate = { reserveId: reserve.id, kind: 'allocate', amountCents: 100, capReason: 'Test: ohne Einnahmen ist der Höchstbetrag 0', resolutionDocumentId: docId };

    // Fremdes Jahr: am 01.05.2026 zählt nur 2026, nicht 2027.
    const foreign = await recordReserveMovement(f.deps, withDms(f), { ...allocate, movementDate: '2026-05-01', forFiscalYearId: f.years['2027']!.id });
    expect(err(foreign)).toMatchObject({ type: 'conflict', code: 'reserveYearNotAllowed', params: { year: '2027' } });

    // Zulässiges Vorjahr, solange es offen ist.
    const allowed = unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, movementDate: '2027-02-10', forFiscalYearId: f.years['2026']!.id }));
    expect(allowed.forFiscalYearId).toBe(f.years['2026']!.id);

    // Abgeschlossenes Vorjahr: kein Vorgang mehr für dessen Höchstbetrag.
    f.closeYear(f.years['2026']!.id);
    const closed = await recordReserveMovement(f.deps, withDms(f), { ...allocate, movementDate: '2027-02-11', forFiscalYearId: f.years['2026']!.id });
    expect(err(closed)).toMatchObject({ type: 'conflict', code: 'reserveYearNotAllowed', params: { year: '2026' } });
    expect(f.deps.db.select().from(financeReserveMovements).all()).toHaveLength(1);

    // Wiedergeöffnet zählt das Vorjahr wieder.
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2026']!.id, note: 'Zuführung nachgetragen' }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, movementDate: '2027-02-11', forFiscalYearId: f.years['2026']!.id }));
  });
});

describe('Befund S: freie Rücklage über dem Höchstbetrag (Teil C Task 2c)', () => {
  it('kennzeichnet exceeded und den Betrag darüber, und verlangt beim Zuführen darüber eine Begründung, die am Vorgang bleibt', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    unwrap(await bookEntryDonation(f));
    const cap = unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(cap).toMatchObject({ exceeded: false, overCents: 0 });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const allocate = { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', forFiscalYearId: f.year.id, resolutionDocumentId: docId };
    // Bis zum Höchstbetrag ohne Begründung.
    unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, amountCents: cap.capCents }));
    const over = await recordReserveMovement(f.deps, withDms(f), { ...allocate, amountCents: 500 });
    expect(err(over)).toMatchObject({ code: 'freeReserveCapExceeded', params: { cap: cap.capCents, over: 500 } });
    const moved = unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, amountCents: 500, capReason: 'Rücklage für das neue Tierheim, Beschluss liegt vor' }));
    expect(moved.capReason).toBe('Rücklage für das neue Tierheim, Beschluss liegt vor');
    expect(unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: f.year.id }))).toMatchObject({ exceeded: true, overCents: 500, usedCents: cap.capCents + 500 });
  });

  it('eine zweckgebundene Rücklage kennt keinen Höchstbetrag', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'replacement', name: 'Ersatz Transporter', purposeText: 'Neuer Transporter', resolutionDocumentId: docId }));
    const moved = unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, resolutionDocumentId: docId }));
    expect(moved.capReason).toBeNull();
  });
});

/** Eine Geldspende — Sphäre `ideal`, ohne `addsToAssets` — für die übrigen zeitnah zu verwendenden Mittel. */
async function bookEntryDonation(f: Awaited<ReturnType<typeof ledgerFixture>>) {
  return bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 10000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 10000 }] });
}

describe('resolution subjects name the reserve (Spec 2026-10-06 § 3)', () => {
  const subjectOf = (f: Awaited<ReturnType<typeof ledgerFixture>>, id: string | null) => f.deps.db.select({ subject: documents.subject }).from(documents).where(eq(documents.id, id!)).get()!.subject;

  it('uses the current name on every upload path and never the id', async () => {
    const f = await ledgerFixture();
    const created = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Tierarztkosten', resolutionUpload: { bytes: pdfBytes(), fileName: 'protokoll.pdf' } }));
    expect(subjectOf(f, created.resolutionDocumentId)).toBe('Beschluss für zurückgelegtes Geld „Tierarztkosten“');

    const renamed = unwrap(await saveReserve(f.deps, withDms(f), { id: created.id, expectedVersion: created.updatedAt, kind: 'free', name: 'Tierarztkosten 2027' }));
    const reuploaded = unwrap(await uploadResolution(f.deps, withDms(f), { id: renamed.id, field: 'resolution', bytes: pdfBytes(), fileName: 'neu.pdf' }));
    expect(subjectOf(f, reuploaded.resolutionDocumentId)).toBe('Beschluss für zurückgelegtes Geld „Tierarztkosten 2027“');

    const carried = unwrap(await recordReserveCarryForward(f.deps, withDms(f), { id: reuploaded.id, expectedVersion: reuploaded.updatedAt, carryForwardCents: 1000, carryForwardDate: '2026-01-01', upload: { bytes: pdfBytes(), fileName: 'vortrag.pdf' } }));
    expect(subjectOf(f, carried.carryForwardDocumentId)).toBe('Beschluss zum Vortrag von zurückgelegtem Geld „Tierarztkosten 2027“');

    const movement = unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: created.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionUpload: { bytes: pdfBytes(), fileName: 'beschluss.pdf' } }));
    expect(subjectOf(f, movement.resolutionDocumentId)).toBe('Beschluss für einen Vorgang an zurückgelegtem Geld „Tierarztkosten 2027“');

    for (const id of [created.resolutionDocumentId, reuploaded.resolutionDocumentId, carried.carryForwardDocumentId, movement.resolutionDocumentId]) {
      expect(subjectOf(f, id)).not.toMatch(ULID_PATTERN);
    }
  });
});

describe('Befund 6 (0.2.7): ein abgelehnter Vorgang lässt keinen hochgeladenen Beschluss in der Akte', () => {
  const trace = (f: Awaited<ReturnType<typeof ledgerFixture>>) => ({
    documents: f.deps.db.select().from(documents).all().length,
    received: f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'dms.receive').length,
  });
  const upload = () => ({ bytes: pdfBytes(), fileName: 'beschluss.pdf' });

  it('recordReserveMovement: Bestand zu klein, über dem Höchstbetrag, Jahr offen, Datum in der Zukunft', async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'] });
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const free = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    f.deps.clock.set('2027-02-12T10:00:00.000Z');
    const before = trace(f);
    const refusals = [
      { input: { reserveId: free.id, kind: 'withdraw', movementDate: '2027-02-10', amountCents: 100 }, code: 'reserveInsufficient' },
      { input: { reserveId: free.id, kind: 'allocate', movementDate: '2027-02-10', amountCents: 100, forFiscalYearId: f.years['2027']!.id }, code: 'freeReserveCapExceeded' },
      { input: { reserveId: free.id, kind: 'allocate', movementDate: '2027-02-10', amountCents: 100, capReason: 'Test' }, code: 'reserveYearAmbiguous' },
      { input: { reserveId: free.id, kind: 'allocate', movementDate: '2027-02-13', amountCents: 100, forFiscalYearId: f.years['2027']!.id, capReason: 'Test' }, code: 'movementDateInFuture' },
    ];
    for (const { input, code } of refusals) {
      expect(err(await recordReserveMovement(f.deps, withDms(f), { ...input, resolutionUpload: upload() }))).toMatchObject({ code });
      expect(trace(f)).toEqual(before);
    }
    expect(f.deps.db.select().from(financeReserveMovements).all()).toHaveLength(0);
  });

  it('saveReserve, uploadResolution, recordReserveCarryForward und requestPurposeTransfer lehnen vor dem Ablegen ab', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const before = trace(f);
    expect(err(await saveReserve(f.deps, withDms(f), { kind: 'replacement', name: 'Ohne Zweck', resolutionUpload: upload() }))).toMatchObject({ code: 'reservePurposeTextRequired' });
    expect(err(await uploadResolution(f.deps, withDms(f), { id: 'fehlt', field: 'resolution', bytes: pdfBytes(), fileName: 'b.pdf' }))).toMatchObject({ type: 'notFound' });
    expect(err(await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: '2000-01-01T00:00:00.000Z', carryForwardCents: 100, carryForwardDate: '2026-01-01', upload: upload() }))).toMatchObject({ type: 'conflict' });
    expect(err(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: f.abroadPurpose.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-12-31', reason: 'Umschichtung', documentUpload: upload() }))).toMatchObject({ code: 'transferDateInFuture' });
    expect(trace(f)).toEqual(before);
  });
});

describe('F-B2 (0.4.5): Art und Vortrag einer Rücklage mit Vorgängen oder Vortrag im abgeschlossenen Jahr', () => {
  const setup = async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'] });
    f.deps.clock.set('2027-03-01T10:00:00.000Z');
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'replacement', name: 'Ersatz Transporter', purposeText: 'Neuer Transporter', resolutionDocumentId: docId }));
    return { f, docId, reserve };
  };
  const edit = (r: { id: string; updatedAt: string; name: string; purposeText: string | null; carryForwardCents: number | null; carryForwardDate: string | null }, patch: Record<string, unknown>) => ({
    id: r.id, expectedVersion: r.updatedAt, kind: 'replacement', name: r.name, purposeText: r.purposeText, carryForwardCents: r.carryForwardCents, carryForwardDate: r.carryForwardDate, ...patch,
  });

  it('locks the kind once the reserve has a movement — the name stays editable', async () => {
    const { f, docId, reserve } = await setup();
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2027-02-01', amountCents: 5000, resolutionDocumentId: docId }));
    const current = unwrap(await listReserves(f.deps, f.ctx, {})).find((r) => r.id === reserve.id)!;
    expect(current.kindLocked).toBe(true);
    expect(err(await saveReserve(f.deps, withDms(f), edit(current, { kind: 'free', purposeText: null })))).toMatchObject({ type: 'conflict', code: 'reserveKindLocked' });
    expect(unwrap(await saveReserve(f.deps, withDms(f), edit(current, { name: 'Ersatz Bus' }))).name).toBe('Ersatz Bus');
  });

  it('locks kind and carry-forward when the carry-forward lies in a closed year — clearing it to delete fails, too', async () => {
    const { f, docId, reserve } = await setup();
    const carried = unwrap(await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 1000, carryForwardDate: '2026-01-01', documentId: docId }));
    f.closeYear(f.years['2026']!.id);
    expect(err(await saveReserve(f.deps, withDms(f), edit(carried, { kind: 'free', purposeText: null })))).toMatchObject({ type: 'conflict', code: 'reserveKindLocked' });
    expect(err(await saveReserve(f.deps, withDms(f), edit(carried, { carryForwardCents: null, carryForwardDate: null })))).toMatchObject({ type: 'conflict', code: 'reserveCarryForwardLocked' });
    expect(err(await recordReserveCarryForward(f.deps, withDms(f), { id: carried.id, expectedVersion: carried.updatedAt, carryForwardCents: 2000, carryForwardDate: '2026-01-01' }))).toMatchObject({ type: 'conflict', code: 'reserveCarryForwardLocked' });
    expect(err(await deleteReserve(f.deps, f.ctx, { id: carried.id }))).toMatchObject({ code: 'reserveInUse' });
    expect(f.deps.db.select().from(financeReserves).where(eq(financeReserves.id, carried.id)).get()).toMatchObject({ kind: 'replacement', carryForwardCents: 1000 });

    // Wiedergeöffnet ist alles wieder frei.
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2026']!.id, note: 'Vortrag korrigieren' }));
    const cleared = unwrap(await saveReserve(f.deps, withDms(f), edit(carried, { carryForwardCents: null, carryForwardDate: null })));
    expect(cleared.carryForwardCents).toBeNull();
    unwrap(await saveReserve(f.deps, withDms(f), edit(cleared, { kind: 'free', purposeText: null })));
  });

  it('leaves kind and carry-forward free without movements and without a carry-forward in a closed year', async () => {
    const { f, docId, reserve } = await setup();
    const carried = unwrap(await recordReserveCarryForward(f.deps, withDms(f), { id: reserve.id, expectedVersion: reserve.updatedAt, carryForwardCents: 1000, carryForwardDate: '2027-01-01', documentId: docId }));
    f.closeYear(f.years['2026']!.id);
    expect(unwrap(await listReserves(f.deps, f.ctx, {})).find((r) => r.id === reserve.id)!.kindLocked).toBe(false);
    const changed = unwrap(await recordReserveCarryForward(f.deps, withDms(f), { id: carried.id, expectedVersion: carried.updatedAt, carryForwardCents: 1500, carryForwardDate: '2027-01-01' }));
    const kindChanged = unwrap(await saveReserve(f.deps, withDms(f), { ...edit(changed, { kind: 'free', purposeText: null }) }));
    expect(kindChanged.kind).toBe('free');
    const cleared = unwrap(await saveReserve(f.deps, withDms(f), { ...edit(kindChanged, { kind: 'free', purposeText: null, carryForwardCents: null, carryForwardDate: null }) }));
    expect(cleared.carryForwardCents).toBeNull();
  });
});

describe('M1 Task 2: Rücklagen im wGB und in der Vermögensverwaltung, nachträgliche Bildung (§ 62 Abs. 2 AO)', () => {
  it('the schema knows exactly the reserve kinds of the rules', () => {
    expect(financeReserves.kind.enumValues).toEqual([...RESERVE_KINDS]);
  });

  it('business and asset management reserves need a reason', async () => {
    const f = await ledgerFixture();
    const resolutionUpload = { bytes: pdfBytes(), fileName: 'beschluss.pdf' };
    const missing = await saveReserve(f.deps, f.ctx, { kind: 'business', name: 'Rücklage Kühltheke', resolutionUpload });
    expect(err(missing)).toMatchObject({ type: 'conflict', code: 'reserveReasonRequired' });
    const saved = unwrap(await saveReserve(f.deps, f.ctx, { kind: 'business', name: 'Rücklage Kühltheke', purposeText: 'Ersatz der Kühltheke', resolutionUpload }));
    expect(saved.kind).toBe('business');
    const audit = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.reserve.save');
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.after as string)).toMatchObject({ kind: 'business' });
    const vv = await saveReserve(f.deps, f.ctx, { kind: 'assetManagement', name: 'Rücklage Vermietung', purposeText: '  ', resolutionUpload });
    expect(err(vv)).toMatchObject({ code: 'reserveReasonRequired' });
  });

  it('operation reserves stay outside the free reserve cap', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    unwrap(await bookEntryDonation(f));
    const before = freeReserveCapInternal(f.deps.db, f.year.id)!.usedCents;
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'assetManagement', name: 'Rücklage Vermietung', purposeText: 'Renovierung', resolutionDocumentId: docId }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 25_000, resolutionDocumentId: docId }));
    expect(freeReserveCapInternal(f.deps.db, f.year.id)!.usedCents).toBe(before);
  });

  it('late formation for a § 62 reserve', async () => {
    const f = await ledgerFixture({ years: ['2023', '2024', '2025', '2026'] });
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const project = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'projectFunds', name: 'Neues Gehege', purposeText: 'Bau eines Geheges', resolutionDocumentId: docId }));
    const allocate = { reserveId: project.id, kind: 'allocate', movementDate: '2026-03-01', amountCents: 1_000, resolutionDocumentId: docId };
    const late = unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, forFiscalYearId: f.years['2024']!.id }));
    expect(late.forFiscalYearId).toBe(f.years['2024']!.id);
    const tooLate = await recordReserveMovement(f.deps, withDms(f), { ...allocate, forFiscalYearId: f.years['2023']!.id });
    expect(err(tooLate)).toMatchObject({ type: 'conflict', code: 'reserveLateFormationTooLate', params: { year: '2023', until: '2025-12-31' } });
    const ownYear = unwrap(await recordReserveMovement(f.deps, withDms(f), { ...allocate, forFiscalYearId: f.years['2026']!.id }));
    expect(ownYear.forFiscalYearId).toBeNull();
    const without = unwrap(await recordReserveMovement(f.deps, withDms(f), allocate));
    expect(without.forFiscalYearId).toBeNull();
    const business = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'business', name: 'Rücklage Vereinsfest', purposeText: 'Ersatz der Kühltheke', resolutionDocumentId: docId }));
    const refused = await recordReserveMovement(f.deps, withDms(f), { ...allocate, reserveId: business.id, forFiscalYearId: f.years['2025']!.id });
    expect(err(refused)).toMatchObject({ type: 'conflict', code: 'reserveYearNotAllowed', params: { year: '2025' } });
    // Ein späteres Jahr als das des Vorgangstags ist kein Bezugsjahr.
    const f2 = await ledgerFixture({ years: ['2026', '2027'] });
    const doc2 = insertDocument(f2, { subject: 'Protokoll', typeKey: 'minutes' });
    const p2 = unwrap(await saveReserve(f2.deps, withDms(f2), { kind: 'replacement', name: 'Transporter', purposeText: 'Ersatz', resolutionDocumentId: doc2 }));
    const future = await recordReserveMovement(f2.deps, withDms(f2), { reserveId: p2.id, kind: 'allocate', movementDate: '2026-03-01', amountCents: 1_000, resolutionDocumentId: doc2, forFiscalYearId: f2.years['2027']!.id });
    expect(err(future)).toMatchObject({ type: 'conflict', code: 'reserveYearNotAllowed', params: { year: '2027' } });
  });
});

/**
 * Ein Modul, das Beschlüsse beschriftet wie Gremien (`recordLabels`), dazu ihre Eckdaten über die Quelle (V-3):
 * `R1` Rücklage, festgeschrieben, angenommen; `R2` Rücklage, nicht festgeschrieben; `R3` Entlastung; `R4` abgelehnt.
 */
const FACTS: Record<string, ResolutionFacts> = {
  R1: { kind: 'reserve', final: true, outcome: 'adopted', decidedOn: '2026-03-14' },
  R2: { kind: 'reserve', final: false, outcome: 'adopted', decidedOn: '2026-07-15' },
  R3: { kind: 'discharge', final: true, outcome: 'adopted', decidedOn: '2026-03-14' },
  R4: { kind: 'reserve', final: true, outcome: 'rejected', decidedOn: '2026-03-14' },
};
registerResolutionFactsSource((deps, _db, id) => (isModuleEnabled(deps, 'governance') ? (FACTS[id] ?? null) : null));
const resolutionsLike = defineModule({
  key: 'governance',
  version: '1',
  permissions: ['governance.read'],
  recordLabels: (_deps, _ctx, entityType, id) => (entityType !== 'governanceResolution' ? null : FACTS[id] ? { label: `Beschluss ${id}`, href: `/governance/resolutions/${id}`, state: 'ok' } : { label: '', href: null, state: 'missing' }),
});

describe('reserve resolution from Gremien (G7)', () => {
  it('a resolution alone satisfies the duty; an unknown one is refused', async () => {
    const f = await ledgerFixture({ extraModules: [resolutionsLike] });
    const created = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionId: 'R1' }));
    expect(created).toMatchObject({ resolutionId: 'R1', resolutionDocumentId: null, resolution: { label: 'Beschluss R1', href: '/governance/resolutions/R1' } });
    expect(err(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Andere', resolutionId: 'R9' }))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionUnknown' }] });
  });

  it('linkResolution sets the resolution on an existing reserve', async () => {
    const f = await ledgerFixture({ extraModules: [resolutionsLike] });
    const docId = insertDocument(f, { subject: 'Beschluss' });
    const created = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    expect(unwrap(await linkResolution(f.deps, withDms(f), { id: created.id, field: 'resolutionId', resolutionId: 'R1' }))).toMatchObject({ resolutionId: 'R1', resolutionDocumentId: docId });
    // V-7: welcher Beschluss verknüpft wurde, steht im Protokoll.
    const linked = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.reserve.linkResolution').at(-1)!;
    expect([JSON.parse(linked.before!).resolutionId, JSON.parse(linked.after!).resolutionId]).toEqual([null, 'R1']);
    expect(err(await linkResolution(f.deps, withDms(f), { id: created.id, field: 'resolutionId', resolutionId: 'R9' }))).toMatchObject({ type: 'validation' });
  });

  it('V-3: only a sealed, adopted resolution of kind reserve', async () => {
    const f = await ledgerFixture({ extraModules: [resolutionsLike] });
    const issue = async (resolutionId: string) => err(await saveReserve(f.deps, withDms(f), { kind: 'free', name: `Rücklage ${resolutionId}`, resolutionId }));
    expect(await issue('R2')).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionNotFinal' }] });
    expect(await issue('R4')).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionNotFinal' }] });
    expect(await issue('R3')).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionWrongKind', params: { expected: 'reserve' } }] });
    const docId = insertDocument(f, { subject: 'Beschluss' });
    const created = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    expect(err(await linkResolution(f.deps, withDms(f), { id: created.id, field: 'resolutionId', resolutionId: 'R3' }))).toMatchObject({ issues: [{ message: 'resolutionWrongKind', params: { expected: 'reserve' } }] });
  });

  it('without Gremien a resolution id is unknown, the document still works', async () => {
    const f = await ledgerFixture();
    expect(err(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionId: 'R1' }))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionUnknown' }] });
    const docId = insertDocument(f, { subject: 'Beschluss' });
    expect(unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }))).toMatchObject({ resolutionId: null, resolution: null });
  });
});
