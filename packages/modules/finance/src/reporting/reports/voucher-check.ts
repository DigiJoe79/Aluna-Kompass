import { paperDate, type DbOrTx } from '@kompass/core';
import { inArray, sum } from 'drizzle-orm';
import { undocumentedEntriesOf } from '../../ledger/period';
import { vouchersWithoutEntryInternal } from '../../ledger/vouchers';
import { financeEntries, financeEntryJustifications, financeMoneyLines } from '../../schema';
import { reusedEvidenceInternal, type ReusedEvidenceGroup, type ReusedEvidenceUse } from '../reused-evidence';
import type { ReportComputeEnv, ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { reportTimeZone, TIME_ZONE_SETTING } from '../../zoned-days';
import { amountCell, checkYearOrDate, heading, paragraph, reportYearInternal, strongCell, table, textCell, yearParamsSchema, type ReportYear } from './common';

/**
 * Belegprüfung (Finanz-Spec § 9.2 und § 9.4, Rechenschaft B1 Task 8): Buchungen ohne Beleg mit ihrer Begründung,
 * Belege ohne Buchung und mehrfach verwendete Nachweise. Gruppe Kassenprüfung — geht damit in die Prüffassungen des
 * Prüfpakets. Mit Personenbezug (Begründungen und Betreffs sind Freitext).
 *
 * Die Belege ohne Buchung liest der Bericht direkt aus der Akte, weil `compute` keinen `ctx` hat. Das ist mit Prinzip 6
 * vereinbar: Der Bericht verlangt `finance.read`, und die Finanzbelegarten (`finance.voucherTypes`) liegen im
 * Schutzbereich `finance` — wer den Bericht lesen darf, darf auch diese Belege lesen.
 */

export interface VoucherCheckReport {
  year: ReportYear;
  withoutVoucher: { entryId: string; entryNumber: string | null; entryDate: string; amountCents: number; justification: string | null }[];
  vouchersWithoutEntry: { documentId: string; number: string | null; documentDate: string; typeKey: string; subject: string }[];
  reusedEvidence: ReusedEvidenceGroup[];
}

const VOUCHER_TYPES_KEY = 'finance.voucherTypes';

export function computeVoucherCheckReport(db: DbOrTx, params: ReportParams, env: ReportComputeEnv): VoucherCheckReport {
  const year = reportYearInternal(db, params.fiscalYearId!);
  const ids = undocumentedEntriesOf(db, year.id).map((u) => u.entryId);
  const entries = ids.length === 0 ? [] : db.select().from(financeEntries).where(inArray(financeEntries.id, ids)).all();
  const notes = new Map(ids.length === 0 ? [] : db.select().from(financeEntryJustifications).where(inArray(financeEntryJustifications.entryId, ids)).all().map((j) => [j.entryId, j.note]));
  // Betrag einer Buchung: die Summe ihrer Geldzeilen (wie gezahlt).
  const amounts = new Map(ids.length === 0 ? [] : db.select({ entryId: financeMoneyLines.entryId, total: sum(financeMoneyLines.amountCents) }).from(financeMoneyLines).where(inArray(financeMoneyLines.entryId, ids)).groupBy(financeMoneyLines.entryId).all().map((r) => [r.entryId, Number(r.total ?? 0)]));
  const withoutVoucher = entries
    .map((e) => ({ entryId: e.id, entryNumber: e.number, entryDate: e.entryDate, amountCents: amounts.get(e.id) ?? 0, justification: notes.get(e.id) ?? null }))
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? '').localeCompare(b.entryNumber ?? ''));
  const typeKeys = Array.isArray(env.settings[VOUCHER_TYPES_KEY]) ? (env.settings[VOUCHER_TYPES_KEY] as string[]) : [];
  const vouchersWithoutEntry = vouchersWithoutEntryInternal(db, typeKeys, { from: year.startsOn, to: year.endsOn }).map((d) => ({ documentId: d.id, number: d.number, documentDate: d.documentDate, typeKey: d.typeKey, subject: d.subject }));
  return { year, withoutVoucher, vouchersWithoutEntry, reusedEvidence: reusedEvidenceInternal(db, { from: year.startsOn, to: year.endsOn }, reportTimeZone(env)) };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const USE_TEXT: Record<ReusedEvidenceUse['kind'], string> = { voucher: 'Buchung', partnerEvidence: 'Zahlung an Partner', expenseReceipt: 'Auslage' };

export function voucherCheckTypst(data: VoucherCheckReport, _ctx?: ReportRenderContext): string {
  const parts: string[] = [heading(2, 'Buchungen ohne Beleg')];
  if (data.withoutVoucher.length === 0) parts.push(paragraph('Jede festgeschriebene Buchung des Jahres ist belegt.'));
  else parts.push(table('(22mm, 26mm, 26mm, 1fr)', ['Datum', 'Nr.', 'in €', 'Begründung'], data.withoutVoucher.map((e) => [textCell(paperDate(e.entryDate as never)), textCell(e.entryNumber ?? ''), amountCell(e.amountCents), textCell(e.justification ?? 'keine')])));

  parts.push(heading(2, 'Belege ohne Buchung'));
  if (data.vouchersWithoutEntry.length === 0) parts.push(paragraph('Kein Beleg des Jahres ist ohne Buchung.'));
  else parts.push(table('(22mm, 30mm, 1fr)', ['Datum', 'Nr.', 'Betreff'], data.vouchersWithoutEntry.map((d) => [textCell(paperDate(d.documentDate as never)), textCell(d.number ?? ''), textCell(d.subject)])));

  parts.push(heading(2, 'Mehrfach verwendete Nachweise'));
  if (data.reusedEvidence.length === 0) parts.push(paragraph('Kein Nachweis ist an mehr als einem Vorgang derselben Art verwendet.'));
  else {
    parts.push(paragraph('Derselbe Nachweis an verschiedenen Vorgängen derselben Art. Eine Rücknahme oder eine Erstattung zählt nicht. Teilzahlungen einer Rechnung erscheinen hier ebenfalls.'));
    // Je Nachweis eine Kopfzeile mit seiner Nummer, darunter die Vorgänge (Designer Runde 6, 266). „Vorgang“ nur, wenn
    // nicht alles Buchungen sind. Dieselbe Datei unter zwei Nummern steht mit beiden Nummern im Kopf.
    const withKind = data.reusedEvidence.some((g) => g.uses.some((u) => u.kind !== 'voucher'));
    const columns = withKind ? 3 : 2;
    const rows = data.reusedEvidence.flatMap((g) => {
      const numbers = [...new Set(g.uses.map((u) => u.documentNumber).filter((n): n is string => n !== null))];
      return [
        [`table.cell(colspan: ${columns})${strongCell(numbers.join(' · ') || 'ohne Nummer')}`],
        ...g.uses.map((u) => [textCell(paperDate(u.date as never)), ...(withKind ? [textCell(USE_TEXT[u.kind])] : []), textCell(u.refNumber ?? '')]),
      ];
    });
    parts.push(table(withKind ? '(22mm, 1fr, 30mm)' : '(22mm, 1fr)', ['Datum', ...(withKind ? ['Vorgang'] : []), 'Nr.'], rows));
  }
  return parts.join('\n\n');
}

export const voucherCheckReport: ReportDefinition<VoucherCheckReport> = {
  key: 'voucherCheck',
  group: 'audit',
  personal: true,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearParamsSchema,
  checkParams: checkYearOrDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  settingKeys: [VOUCHER_TYPES_KEY, TIME_ZONE_SETTING],
  compute: computeVoucherCheckReport,
  toTypst: voucherCheckTypst,
  titleKey: 'finance.reports.voucherCheck.title',
  paperTitle: 'Belegprüfung',
};
