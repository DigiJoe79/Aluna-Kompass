import { deleteFollowUpsFor, notifyRecordDeleted, recordAudit, todayIn, type CallContext, type DbOrTx, type Deps, type DueItemInput, type LabelRef, type RetentionHoldInput } from '@kompass/core';
import { financeOpenItems, openCentsInternal } from '@kompass/module-finance';
import { documentLinks } from '@kompass/module-dms';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { MembersAborted, membersConflict } from './errors';
import { memberDunningNotices, memberFeeAgreements, memberFeeCharges, memberMemberships, memberRunLetters, memberTypePeriods, type MembershipRow } from './schema';

const endOfYearAfter = (isoDay: string, years: number) => `${Number(isoDay.slice(0, 4)) + years}-12-31`;

/**
 * Bis wann eine Mitgliedschaft aufbewahrt wird (Spec § 3.2, Entscheid F2): solange sie läuft (auch als offener
 * Antrag), danach bis zum Ende des Kalenderjahres nach `endsOn` bzw. `rejectedOn`. Ein offener Beitragsposten
 * verlängert bis zum Ende des dritten Jahres nach seinem Fälligkeitsjahr (Verjährung). `null` = läuft noch.
 */
export function membershipRetainUntil(row: Pick<MembershipRow, 'rejectedOn' | 'endsOn'> & Partial<MembershipRow>, openFeeDueDates: readonly string[]): string | null {
  const closedOn = row.rejectedOn ?? row.endsOn;
  if (!closedOn) return null;
  return [endOfYearAfter(closedOn, 1), ...openFeeDueDates.map((d) => endOfYearAfter(d, 3))].sort().at(-1)!;
}

/** Die Fälligkeiten der noch offenen Beitragsposten einer Mitgliedschaft (nicht storniert, Rest offen). */
function openFeeDueDates(db: DbOrTx, membershipId: string): string[] {
  return db
    .select({ id: financeOpenItems.id, dueOn: financeOpenItems.dueOn, cancelledAt: financeOpenItems.cancelledAt })
    .from(memberFeeCharges)
    .innerJoin(financeOpenItems, eq(memberFeeCharges.openItemId, financeOpenItems.id))
    .where(and(eq(memberFeeCharges.membershipId, membershipId), isNotNull(memberFeeCharges.openItemId)))
    .all()
    .filter((i) => i.cancelledAt === null && i.dueOn !== null && openCentsInternal(db, i.id) > 0)
    .map((i) => i.dueOn!);
}

/**
 * Wie viele Beitragsposten einer Mitgliedschaft noch offen sind — nicht bezahlt, nicht erlassen, nicht storniert;
 * teilweise bezahlt zählt als offen. Solange einer offen ist, wird die Mitgliedschaft nicht gelöscht: Sonst bliebe in
 * den Finanzen eine Forderung, die niemand mehr stornieren kann.
 */
export const openFeeCountInternal = (db: DbOrTx, membershipId: string): number => openFeeDueDates(db, membershipId).length;

/** Die Frist einer gespeicherten Mitgliedschaft, verlängert durch offene Beitragsposten (Plan M3). */
export const retainUntilOf = (db: DbOrTx, row: MembershipRow): string | null => membershipRetainUntil(row, openFeeDueDates(db, row.id));

/** Bezeichnung einer Mitgliedschaft als Halter oder fälliger Eintrag: die Nummer, ein Antrag ohne Nummer als solcher. */
export const membershipLabel = (row: Pick<MembershipRow, 'memberNumber'>): LabelRef =>
  row.memberNumber ? { key: 'members.retention.holdLabel', params: { memberNumber: row.memberNumber } } : { key: 'members.retention.applicationLabel' };

/**
 * Halter: Jede Mitgliedschaft hält ihren Kontakt, ihren Antrag, das Dokument zu ihrem Ende und ihre Briefe — die Art `consent`
 * allein liefe ab Dokumentdatum ab, auch während die Mitgliedschaft noch läuft.
 */
export function membersRetentionHolds(deps: Deps, entityType: string, id: string): RetentionHoldInput[] {
  let rows: MembershipRow[];
  if (entityType === 'contact') rows = deps.db.select().from(memberMemberships).where(eq(memberMemberships.contactId, id)).all();
  else if (entityType === 'document') {
    // Auch die Briefe der Mitgliedschaft (Plan M4): verknüpft über die Akte.
    const linked = deps.db.select({ id: documentLinks.entityId }).from(documentLinks).where(and(eq(documentLinks.documentId, id), eq(documentLinks.entityType, 'membership'))).all().map((l) => l.id);
    rows = deps.db.select().from(memberMemberships).where(or(eq(memberMemberships.applicationDocumentId, id), eq(memberMemberships.endDocumentId, id), linked.length ? inArray(memberMemberships.id, linked) : undefined)).all();
  }
  else return [];
  // Ein offener Beitrag hält ohne Ende, bis er bezahlt oder erlassen ist.
  return rows.map((row) => ({ label: membershipLabel(row), until: openFeeCountInternal(deps.db, row.id) > 0 ? null : retainUntilOf(deps.db, row), entity: 'membership', id: row.id }));
}

/** Mitgliedschaften, deren Frist abgelaufen ist — fällig heißt nicht gelöscht: Ein Mensch bestätigt. */
export function membersRetentionDue(deps: Deps): DueItemInput[] {
  const today = todayIn(deps);
  return deps.db
    .select()
    .from(memberMemberships)
    .all()
    .flatMap((row) => {
      const until = retainUntilOf(deps.db, row);
      return until !== null && until < today && openFeeCountInternal(deps.db, row.id) === 0 ? [{ entity: 'membership', id: row.id, label: membershipLabel(row), dueSince: until, href: `/members/${row.id}` }] : [];
    });
}

/** Löscht eine Mitgliedschaft samt Art-Verlauf und protokolliert es — für den Dienst und das Löschen des Kontakts. */
export function deleteMembershipInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, row: MembershipRow): void {
  // Die Beitragszeilen und Vereinbarungen gehen mit; die Posten bleiben als Finanzdaten (Herkunft dann „fehlt“).
  tx.delete(memberFeeCharges).where(eq(memberFeeCharges.membershipId, row.id)).run();
  tx.delete(memberFeeAgreements).where(eq(memberFeeAgreements.membershipId, row.id)).run();
  tx.delete(memberTypePeriods).where(eq(memberTypePeriods.membershipId, row.id)).run();
  tx.delete(memberRunLetters).where(eq(memberRunLetters.membershipId, row.id)).run();
  tx.delete(memberDunningNotices).where(eq(memberDunningNotices.membershipId, row.id)).run();
  tx.delete(memberMemberships).where(eq(memberMemberships.id, row.id)).run();
  // I-del: Wiedervorlagen tragen Freitext; die Akte löst ihre Bezüge selbst (`recordDeleted`), eingetragene Briefe bleiben.
  const followUps = deleteFollowUpsFor(tx, 'membership', row.id);
  recordAudit(tx, deps, ctx, { action: 'members.membership.delete', entityType: 'membership', entityId: row.id, before: { memberNumber: row.memberNumber, endsOn: row.endsOn, rejectedOn: row.rejectedOn, removed: { followUps } }, params: { memberNumber: row.memberNumber } });
  notifyRecordDeleted(tx, deps, ctx, 'membership', row.id);
}

/** Ein Kontakt wurde gelöscht: seine Mitgliedschaften gehen mit (Spec § 3.2). */
export function membersRecordDeleted(tx: DbOrTx, deps: Deps, ctx: CallContext, entityType: string, id: string): void {
  if (entityType !== 'contact') return;
  for (const row of tx.select().from(memberMemberships).where(eq(memberMemberships.contactId, id)).all()) {
    // Der Halter oben verhindert das schon; bleibt doch ein Beitrag offen, rollt das Löschen des Kontakts zurück.
    const count = openFeeCountInternal(tx, row.id);
    if (count > 0) throw new MembersAborted(membersConflict('membershipHasOpenFees', { count }));
    deleteMembershipInternal(tx, deps, ctx, row);
  }
}
