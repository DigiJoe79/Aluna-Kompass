import { isoNow, recordAudit, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { governanceAttendance, governanceCircularResponses, governanceMotions, governanceRegisterFilings } from './schema';

/**
 * Ein fremder Datensatz wurde gelöscht (`recordDeleted`, Spec § 9.3): Bei einem Kontakt verliert ein Antrag nur den
 * Bezug zur antragstellenden Person — kein Halter, der Name steht im Dokument. Ebenso die Anwesenheit: Stimmrecht und
 * Zeiten bleiben, der Bezug geht (Spec § 9.3). Ebenso der Notar einer Registeranmeldung (G5).
 */
export function governanceRecordDeleted(tx: DbOrTx, deps: Deps, ctx: CallContext, entityType: string, id: string): void {
  if (entityType !== 'contact') return;
  for (const motion of tx.select().from(governanceMotions).where(eq(governanceMotions.submittedByContactId, id)).all()) {
    tx.update(governanceMotions).set({ submittedByContactId: null, updatedAt: isoNow(deps.clock) }).where(eq(governanceMotions.id, motion.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.motion.contactRemoved', entityType: 'governanceMotion', entityId: motion.id, params: {} });
  }
  for (const row of tx.select().from(governanceAttendance).where(eq(governanceAttendance.contactId, id)).all()) {
    tx.update(governanceAttendance).set({ contactId: null, updatedAt: isoNow(deps.clock) }).where(eq(governanceAttendance.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.attendance.contactRemoved', entityType: 'governanceAttendance', entityId: row.id, params: {} });
  }
  for (const row of tx.select().from(governanceCircularResponses).where(eq(governanceCircularResponses.contactId, id)).all()) {
    tx.update(governanceCircularResponses).set({ contactId: null, updatedAt: isoNow(deps.clock) }).where(eq(governanceCircularResponses.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.circular.contactRemoved', entityType: 'governanceCircular', entityId: row.circularId, params: {} });
  }
  for (const row of tx.select().from(governanceRegisterFilings).where(eq(governanceRegisterFilings.notaryContactId, id)).all()) {
    tx.update(governanceRegisterFilings).set({ notaryContactId: null, updatedAt: isoNow(deps.clock) }).where(eq(governanceRegisterFilings.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.register.notaryRemoved', entityType: 'governanceRegisterFiling', entityId: row.id, params: {} });
  }
}
