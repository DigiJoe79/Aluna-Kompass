import { newId } from '@kompass/core';
import { financePurposeTransfers, financeReserveMovements, financeReserves } from '../src/schema';

/**
 * Direkte Einfüge-Helfer für zurückgelegtes Geld, seine Vorgänge und
 * Umwidmungen (F8b Task 1) — wie `partner-fixture.ts` für Partner. Kein
 * Dienst dahinter: Diese Helfer legen nur Zeilen an, um Trigger, Halter und
 * Verweise unabhängig von den noch fehlenden Diensten (Task 2/3) zu prüfen.
 */
const T = '2026-03-02T10:00:00.000Z';

export function insertReserve(db: { insert: Function }, o: Partial<typeof financeReserves.$inferInsert> = {}): string {
  const id = o.id ?? newId();
  (db as any)
    .insert(financeReserves)
    .values({ id, kind: 'free', name: 'Freie Rücklage', purposeText: null, purposeId: null, resolutionDocumentId: 'DOC-MINUTES', carryForwardCents: null, carryForwardDate: null, carryForwardDocumentId: null, isActive: true, createdByUserId: 'U1', createdAt: T, updatedAt: T, ...o })
    .run();
  return id;
}

export function insertReserveMovement(db: { insert: Function }, reserveId: string, o: Partial<typeof financeReserveMovements.$inferInsert> = {}): string {
  const id = o.id ?? newId();
  (db as any)
    .insert(financeReserveMovements)
    .values({ id, reserveId, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, forFiscalYearId: null, resolutionDocumentId: 'DOC-MINUTES', note: null, createdByUserId: 'U1', createdAt: T, ...o })
    .run();
  return id;
}

export function insertPurposeTransfer(db: { insert: Function }, o: Partial<typeof financePurposeTransfers.$inferInsert> & { number: string }): string {
  const id = o.id ?? newId();
  (db as any)
    .insert(financePurposeTransfers)
    .values({ id, fromPurposeId: null, toPurposeId: null, amountCents: 5000, transferDate: '2026-03-05', reason: 'Umwidmung laut Beschluss', documentId: 'DOC-MINUTES', state: 'submitted', createdByUserId: 'U1', createdAt: T, ...o })
    .run();
  return id;
}
