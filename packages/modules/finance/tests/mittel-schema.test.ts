import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { financePurposeTransfers, financeReserveMovements, financeReserves } from '../src/schema';
import { setupFinance } from './helpers';
import { insertPurposeTransfer, insertReserve, insertReserveMovement } from './mittel-fixture';

/**
 * Trigger der drei neuen Tabellen (F8b Task 1, Migration 0031): ein Vorgang
 * an zurückgelegtem Geld ist unveränderlich und wird nie gelöscht, eine
 * Umwidmung entsteht ohne Entwurf und ist nach der Entscheidung
 * unveränderlich. Reiner Tabellentest, ohne die Dienste aus Task 2/3.
 */
describe('finance F8b tables — triggers (Task 1)', () => {
  it('never lets a movement of reserved funds change, except clearing its resolution once', () => {
    const { deps } = setupFinance();
    const reserveId = insertReserve(deps.db);
    const movementId = insertReserveMovement(deps.db, reserveId);
    expect(() => deps.db.update(financeReserveMovements).set({ amountCents: 9999 }).where(eq(financeReserveMovements.id, movementId)).run()).toThrow(/permanent/);
    expect(() => deps.db.update(financeReserveMovements).set({ resolutionDocumentId: null }).where(eq(financeReserveMovements.id, movementId)).run()).not.toThrow();
    expect(() => deps.db.delete(financeReserveMovements).where(eq(financeReserveMovements.id, movementId)).run()).toThrow(/permanent/);
  });

  it('refuses to delete reserved funds with a movement or a carry-forward, but allows an unused one', () => {
    const { deps } = setupFinance();
    const unusedId = insertReserve(deps.db);
    expect(() => deps.db.delete(financeReserves).where(eq(financeReserves.id, unusedId)).run()).not.toThrow();

    const usedId = insertReserve(deps.db);
    insertReserveMovement(deps.db, usedId);
    expect(() => deps.db.delete(financeReserves).where(eq(financeReserves.id, usedId)).run()).toThrow(/permanent/);

    const carriedId = insertReserve(deps.db, { carryForwardCents: 1000, carryForwardDate: '2026-01-01', carryForwardDocumentId: 'DOC-MINUTES' });
    expect(() => deps.db.delete(financeReserves).where(eq(financeReserves.id, carriedId)).run()).toThrow(/permanent/);
  });

  it('lets a purpose transfer leave submitted exactly once, and freezes the head afterwards', () => {
    const { deps } = setupFinance();
    const id = insertPurposeTransfer(deps.db, { number: 'UM-2026-001' });
    expect(() =>
      deps.db.update(financePurposeTransfers).set({ state: 'approved', approvedAt: '2026-03-06T09:00:00.000Z', approvedByUserId: 'U2', approvedChannel: 'ui' }).where(eq(financePurposeTransfers.id, id)).run(),
    ).not.toThrow();
    expect(() => deps.db.update(financePurposeTransfers).set({ amountCents: 6000 }).where(eq(financePurposeTransfers.id, id)).run()).toThrow(/permanent/);
    expect(() =>
      deps.db.update(financePurposeTransfers).set({ state: 'rejected', rejectedAt: '2026-03-07T09:00:00.000Z', rejectedByUserId: 'U3', rejectNote: 'zu spät' }).where(eq(financePurposeTransfers.id, id)).run(),
    ).toThrow(/permanent/);
  });

  it('never deletes a purpose transfer, but allows clearing its document once', () => {
    const { deps } = setupFinance();
    const id = insertPurposeTransfer(deps.db, { number: 'UM-2026-002' });
    expect(() => deps.db.update(financePurposeTransfers).set({ documentId: null }).where(eq(financePurposeTransfers.id, id)).run()).not.toThrow();
    expect(() => deps.db.delete(financePurposeTransfers).where(eq(financePurposeTransfers.id, id)).run()).toThrow(/permanent/);
  });
});
