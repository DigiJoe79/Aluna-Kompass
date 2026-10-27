import type { DbOrTx } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { financeEntries, financeEntryDocuments, financeExpenseClaims, financeExpensePositions, financePartnerEvidence, financePartnerPayments } from '../schema';

/**
 * Mehrfach verwendete Nachweise (Finanz-Spec § 9.4, Rechenschaft B1 Task 8, Entscheidung 6 des Plans): derselbe
 * Nachweis an verschiedenen Vorgängen **derselben Art** — Beleg an festgeschriebenen Buchungen, Nachweis an Zahlungen
 * an Partner, Beleg an Auslagen. Schlüssel ist die Prüfsumme (Verknüpfung, sonst Akten-Dokument), sonst die
 * Dokument-ID: So fällt auch dieselbe Datei zweimal hochgeladen auf. Eine Buchung bildet mit ihrer Rücknahme und ihrer
 * Korrekturbuchung einen Vorgang; über Arten hinweg zählt nichts (Auslage → Erstattung, Partnerzahlung → Zahlung
 * tragen denselben Beleg rechtmäßig). Eine Gruppe gehört zum Zeitraum, wenn eine Verwendung darin liegt. Eine
 * Prüfliste, keine Sperre — Teilzahlungen einer Rechnung erscheinen auch. Rein.
 */

export interface ReusedEvidenceUse {
  kind: 'voucher' | 'partnerEvidence' | 'expenseReceipt';
  refId: string;
  refNumber: string | null;
  date: string;
  documentId: string | null;
  documentNumber: string | null;
}

export interface ReusedEvidenceGroup {
  key: string;
  checksum: string | null;
  uses: ReusedEvidenceUse[];
}

type Use = ReusedEvidenceUse & { checksum: string | null; operation: string };

const dayOf = (value: string): string => value.slice(0, 10);

/** Die Akten-Dokumente der Verwendungen (Nummer, Prüfsumme). */
function documentsOf(db: DbOrTx, ids: readonly (string | null)[]): Map<string, { number: string | null; fileChecksum: string | null }> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  return new Map(db.select({ id: documents.id, number: documents.number, fileChecksum: documents.fileChecksum }).from(documents).where(inArray(documents.id, unique)).all().map((d) => [d.id, d]));
}

function voucherUses(db: DbOrTx): Use[] {
  const entries = db.select({ id: financeEntries.id, number: financeEntries.number, entryDate: financeEntries.entryDate, reversesEntryId: financeEntries.reversesEntryId, correctionOfEntryId: financeEntries.correctionOfEntryId }).from(financeEntries).where(eq(financeEntries.status, 'final')).all();
  const byId = new Map(entries.map((e) => [e.id, e]));
  // Der Vorgang einer Buchung: über Rücknahme und Korrektur zurück bis zur ersten Buchung.
  const rootOf = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    for (;;) {
      const e = byId.get(current);
      const parent = e?.reversesEntryId ?? e?.correctionOfEntryId ?? null;
      if (!parent || seen.has(parent)) return current;
      seen.add(current);
      current = parent;
    }
  };
  const links = db.select().from(financeEntryDocuments).where(isNull(financeEntryDocuments.revokedAt)).all().filter((l) => byId.has(l.entryId));
  const docs = documentsOf(db, links.map((l) => l.documentId));
  return links.map((l) => {
    const e = byId.get(l.entryId)!;
    return { kind: 'voucher', refId: e.id, refNumber: e.number, date: e.entryDate, documentId: l.documentId, documentNumber: l.documentNumber, checksum: l.documentChecksum ?? (l.documentId ? (docs.get(l.documentId)?.fileChecksum ?? null) : null), operation: rootOf(e.id) };
  });
}

function partnerEvidenceUses(db: DbOrTx): Use[] {
  const rows = db
    .select({ paymentId: financePartnerEvidence.paymentId, documentId: financePartnerEvidence.documentId, addedAt: financePartnerEvidence.addedAt, number: financePartnerPayments.number })
    .from(financePartnerEvidence)
    .innerJoin(financePartnerPayments, eq(financePartnerPayments.id, financePartnerEvidence.paymentId))
    .where(and(isNotNull(financePartnerEvidence.documentId), ne(financePartnerPayments.state, 'rejected')))
    .all();
  const docs = documentsOf(db, rows.map((r) => r.documentId));
  return rows.map((r) => {
    const d = docs.get(r.documentId!);
    return { kind: 'partnerEvidence', refId: r.paymentId, refNumber: r.number, date: dayOf(r.addedAt), documentId: r.documentId, documentNumber: d?.number ?? null, checksum: d?.fileChecksum ?? null, operation: r.paymentId };
  });
}

function expenseReceiptUses(db: DbOrTx): Use[] {
  const rows = db
    .select({ claimId: financeExpensePositions.claimId, documentId: financeExpensePositions.documentId, documentNumber: financeExpensePositions.documentNumber, positionDate: financeExpensePositions.positionDate, submittedAt: financeExpenseClaims.submittedAt, createdAt: financeExpenseClaims.createdAt, number: financeExpenseClaims.number })
    .from(financeExpensePositions)
    .innerJoin(financeExpenseClaims, eq(financeExpenseClaims.id, financeExpensePositions.claimId))
    .where(and(isNotNull(financeExpensePositions.documentId), inArray(financeExpenseClaims.state, ['submitted', 'approved'])))
    .all();
  const docs = documentsOf(db, rows.map((r) => r.documentId));
  return rows.map((r) => {
    const d = docs.get(r.documentId!);
    return { kind: 'expenseReceipt', refId: r.claimId, refNumber: r.number, date: r.positionDate ?? dayOf(r.submittedAt ?? r.createdAt), documentId: r.documentId, documentNumber: r.documentNumber ?? d?.number ?? null, checksum: d?.fileChecksum ?? null, operation: r.claimId };
  });
}

export function reusedEvidenceInternal(db: DbOrTx, range: { from: string; to: string }): ReusedEvidenceGroup[] {
  const groups = new Map<string, Use[]>();
  for (const use of [...voucherUses(db), ...partnerEvidenceUses(db), ...expenseReceiptUses(db)]) {
    const identity = use.checksum ? `sha:${use.checksum}` : use.documentId ? `doc:${use.documentId}` : null;
    if (!identity) continue;
    const key = `${use.kind}:${identity}`;
    groups.set(key, [...(groups.get(key) ?? []), use]);
  }
  return [...groups]
    .filter(([, uses]) => new Set(uses.map((u) => u.operation)).size > 1 && uses.some((u) => u.date >= range.from && u.date <= range.to))
    .map(([key, uses]): ReusedEvidenceGroup => ({
      key,
      checksum: uses.find((u) => u.checksum)?.checksum ?? null,
      uses: uses
        .sort((a, b) => a.date.localeCompare(b.date) || (a.refNumber ?? '').localeCompare(b.refNumber ?? '') || a.refId.localeCompare(b.refId))
        .map(({ checksum: _c, operation: _o, ...use }) => use),
    }))
    .sort((a, b) => a.uses[0]!.date.localeCompare(b.uses[0]!.date) || a.key.localeCompare(b.key));
}
