import { DEFAULT_TIME_ZONE, paperDate, type DbOrTx } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { coverageRequired, evidenceCoverage, missingEvidence, paymentProofSatisfied, requiredEvidenceKinds } from '../../allocation/evidence-rules';
import { foreignActivityInternal, type ForeignLineEntry, type ForeignPartnerPaymentEntry } from '../../allocation/foreign';
import { positionViewsOf, sumPositionCents } from '../../allocation/partner-proof';
import { openCentsInternal } from '../../ledger/open-items';
import { financePartnerEvidence, financePartnerPayments, financePartnerProfiles } from '../../schema';
import type { ReportComputeEnv, ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { reportTimeZone, TIME_ZONE_SETTING, zonedDayOf } from '../../zoned-days';
import { amountCell, checkYearOrDate, heading, paragraph, reportYearInternal, strongAmountCell, strongCell, table, textCell, yearParamsSchema, type ReportYear } from './common';

/**
 * Auslandsbericht (Finanz-Spec § 9.2, Rechenschaft B1 Task 5): Mittel an Partner im Ausland nach Grundlage, mit dem
 * Stand der Nachweise, dazu die Buchungen mit dem Merkmal „Wird im Ausland verwendet“. Nicht nach dem Sitz eines
 * Kontakts (Joe 2026-10-26, Designer Runde 8, 271): Sonst käme jedes ausländische Software-Abo in den Bericht ans
 * Finanzamt. Mit Personenbezug: Partner- und Kontaktnamen gehören zum Inhalt.
 */

export interface ForeignActivityPayment extends ForeignPartnerPaymentEntry {
  /** Die Nachweise sind anerkannt, oder alle Pflichtarten liegen vollständig vor und die Zahlung ist erfolgt — ohne Frist, rein. */
  proofComplete: boolean;
  evidenceCount: number;
}

/** Eine Buchungszeile mit dem Merkmal „Wird im Ausland verwendet“: Datum · Nr. · Kontakt · Text · Betrag. */
export interface ForeignActivityLine {
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  contactName: string | null;
  text: string;
  amountCents: number;
}

export interface ForeignActivityReport {
  year: ReportYear;
  partnerPayments: { basis: string; payments: ForeignActivityPayment[]; totalCents: number }[];
  abroadLines: ForeignActivityLine[];
  totalCents: number;
}

function proofOf(db: DbOrTx, paymentId: string): { proofComplete: boolean; evidenceCount: number } {
  const p = db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, paymentId)).get()!;
  const evidence = db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.paymentId, paymentId)).all();
  if (p.acknowledgedAt !== null) return { proofComplete: true, evidenceCount: evidence.length };
  const status = db.select({ status: financePartnerProfiles.status }).from(financePartnerProfiles).where(eq(financePartnerProfiles.id, p.partnerId)).get()?.status;
  if (!status) return { proofComplete: false, evidenceCount: evidence.length };
  const positions = positionViewsOf(db, p.id);
  const required = requiredEvidenceKinds({ basis: p.basis, partnerStatus: status, hasGoodsPositions: positions.some((pos) => pos.kind === 'goods') });
  const missing = missingEvidence(required, evidence);
  const covered = !coverageRequired(required) || evidenceCoverage(evidence, sumPositionCents(positions)).complete;
  const paid = paymentProofSatisfied({ retroactive: p.retroactive, openItemSettled: p.openItemId !== null && openCentsInternal(db, p.openItemId) <= 0 });
  const complete = missing.missingKinds.length + missing.missingExplanation.length + missing.missingAmount.length === 0 && covered && paid;
  return { proofComplete: complete, evidenceCount: evidence.length };
}

export function computeForeignActivityReport(db: DbOrTx, params: ReportParams, env?: ReportComputeEnv): ForeignActivityReport {
  const year = reportYearInternal(db, params.fiscalYearId!);
  // Das Land des Vereins zählt hier nicht mehr: Der Bericht folgt dem Merkmal, nicht dem Sitz.
  const view = foreignActivityInternal(db, { from: year.startsOn, to: year.endsOn }, 'DE', reportTimeZone(env));
  // Rechenschaft D2: Vermögensausstattungen (§ 58 Nr. 3 AO) als eigene Grundlage neben § 58 Nr. 1 und § 57.
  const groupOf = (p: ForeignPartnerPaymentEntry) => (p.assetEndowment ? 'endowment58' : p.basis);
  const bases = [...new Set(view.partnerPayments.map(groupOf))].sort();
  const partnerPayments = bases.map((basis) => {
    const payments = view.partnerPayments
      .filter((p) => groupOf(p) === basis)
      .sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? '') || a.paymentId.localeCompare(b.paymentId))
      .map((p) => ({ ...p, ...proofOf(db, p.paymentId) }));
    return { basis, payments, totalCents: payments.reduce((s, p) => s + p.totalCents, 0) };
  });
  const nameOf = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const row = db.select().from(contacts).where(eq(contacts.id, id)).get();
    return row ? displayName(row) || null : null;
  };
  const abroadLines = view.otherAbroadLines.map((l: ForeignLineEntry) => ({ entryId: l.entryId, entryNumber: l.entryNumber, entryDate: l.entryDate, contactName: nameOf(l.contactId), text: l.text ?? '', amountCents: l.amountCents }));
  return { year, partnerPayments, abroadLines, totalCents: partnerPayments.reduce((s, g) => s + g.totalCents, 0) };
}

// ── Papier ─────────────────────────────────────────────────────────────────

/** Grundlage der Zahlung — dieselben Wörter wie die Oberfläche. */
const BASIS_TEXT: Record<string, string> = {
  transfer58: 'Förderung eines Partners (§ 58 Nr. 1 AO)',
  agent57: 'Auftrag an einen Partner (§ 57 Abs. 1 S. 2 AO)',
  endowment58: 'Vermögensausstattung (§ 58 Nr. 3 AO)',
};

function linesTable(lines: ForeignActivityLine[]): string {
  return table('(22mm, 24mm, 40mm, 1fr, 26mm)', ['Datum', 'Nr.', 'Kontakt', 'Text', 'Betrag'], lines.map((l) => [textCell(paperDate(l.entryDate as never)), textCell(l.entryNumber ?? ''), textCell(l.contactName ?? ''), textCell(l.text), amountCell(l.amountCents)]), { rightHeads: [4] });
}

/** Ohne Zahlung an Partner: der Satz des PDF; ohne jede Zeile zugleich `empty` des Berichts (Designer Runde 7, 16a D). */
const FOREIGN_EMPTY = 'Im Geschäftsjahr gibt es keine freigegebenen Zahlungen an Partner.';
const foreignEmpty = (data: ForeignActivityReport): string | null => (data.partnerPayments.length === 0 && data.abroadLines.length === 0 ? FOREIGN_EMPTY : null);

export function foreignActivityTypst(data: ForeignActivityReport, ctx?: ReportRenderContext): string {
  // F-B3: Die Freigabe ist ein Zeitstempel; auf dem Papier steht ihr Tag in der Zone des Vereins (nicht im Hash).
  const timeZone = ctx?.labels['setting.timeZone'] ?? DEFAULT_TIME_ZONE;
  const parts: string[] = [heading(2, 'Zahlungen an Partner')];
  if (data.partnerPayments.length === 0) parts.push(paragraph(FOREIGN_EMPTY));
  for (const g of data.partnerPayments) {
    parts.push(heading(3, BASIS_TEXT[g.basis] ?? g.basis));
    const rows = g.payments.map((p) => [textCell(p.approvedAt ? paperDate(zonedDayOf(p.approvedAt, timeZone) as never) : ''), textCell(p.number ?? ''), textCell(p.partnerName), amountCell(p.totalCents), textCell(`${p.evidenceCount}${p.proofComplete ? ', vollständig' : ', offen'}`)]);
    rows.push([strongCell('Summe'), textCell(''), textCell(''), strongAmountCell(g.totalCents), textCell('')]);
    parts.push(table('(24mm, 28mm, 1fr, 28mm, 30mm)', ['Freigabe', 'Nr.', 'Partner', 'in €', 'Nachweise'], rows));
  }
  if (data.abroadLines.length > 0) parts.push(heading(2, 'Sonstige Buchungen, im Ausland verwendet, in €'), linesTable(data.abroadLines));
  return parts.join('\n\n');
}

export const foreignActivityReportDefinition: ReportDefinition<ForeignActivityReport> = {
  key: 'foreignActivity',
  group: 'taxOffice',
  personal: true,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearParamsSchema,
  checkParams: checkYearOrDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: computeForeignActivityReport,
  settingKeys: [TIME_ZONE_SETTING],
  toTypst: foreignActivityTypst,
  empty: foreignEmpty,
  titleKey: 'finance.reports.foreignActivity.title',
  paperTitle: 'Auslandsbericht',
};
