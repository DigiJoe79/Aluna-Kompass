import { unwrap } from '@kompass/core';
import { schema } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentTypes } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteReserve, freeReserveCap, linkResolution, listReserves, recordReserveCarryForward, recordReserveMovement, saveReserve, setReserveActive, uploadResolution } from '../src/allocation/reserves';
import { setDatedValue } from '../src/ledger/dated-values';
import { bookEntry } from '../src/ledger/finalize';
import { incomeStatement } from '../src/ledger/queries';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeAllocationLines, financeEntries, financeReserveMovements, financeReserves } from '../src/schema';
import { allowHumanOnlyOverMcp, insertDocument, ledgerFixture, pdfBytes } from './helpers';
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

  it('refuses a reserve movement over mcp without the human-only permission and names the remedy', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    const movement = { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen im Jahr ist der Höchstbetrag 0', resolutionDocumentId: docId };
    const agent = { ...withDms(f), channel: 'mcp' as const };
    // A7 (E10): ein Rücklagenvorgang ist sofort unveränderlich — ein Agent erzeugt ihn nur mit der Freigabe des Vereins.
    expect(await recordReserveMovement(f.deps, agent, movement)).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly', messageKey: 'finance.errors.humanOnly' } });
    expect(f.deps.db.select().from(financeReserveMovements).all()).toHaveLength(0);
    allowHumanOnlyOverMcp(f.deps);
    expect((await recordReserveMovement(f.deps, agent, movement)).ok).toBe(true);
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

  it('treats a negative surplus of asset management as zero, and reads 33 percent — not a third', async () => {
    const f = await ledgerFixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'freeReserveAssetShare', validFrom: '2026-01-01', value: 50 }));
    unwrap(await bookEntryDonation(f));
    const cap = unwrap(await freeReserveCap(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(cap.assetManagementSurplusCents).toBe(0);
    expect(cap.capCents).toBe(Math.floor((cap.otherTimelyFundsCents * 10) / 100));
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
