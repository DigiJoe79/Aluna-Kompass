import type { DbOrTx } from '@kompass/core';
import { and, eq, isNull } from 'drizzle-orm';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { missingStatementPdfsInternal } from '../ledger/statement-documents';
import { financeFiscalYears, financeReportReleases, financeReports } from '../schema';
import { canonicalJson } from './hash';
import type { ReportDefinition, ReportFinalizeBlock, ReportGroup, ReportParams, ReportRelease, ReportStage } from './types';

/** Die betroffenen Jahre, ältestes zuerst; unbekannte IDs fallen weg. */
export function reportYearsInternal(db: DbOrTx, def: ReportDefinition, params: ReportParams): { id: string; designation: string; endsOn: string }[] {
  return def
    .years(db, params)
    .map((id) => db.select({ id: financeFiscalYears.id, designation: financeFiscalYears.designation, endsOn: financeFiscalYears.endsOn }).from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get())
    .filter((y): y is { id: string; designation: string; endsOn: string } => Boolean(y))
    .sort((a, b) => a.endsOn.localeCompare(b.endsOn));
}

/**
 * Die Stufe aus dem Zustand (Spec § A): irgendein betroffenes Jahr offen → `preliminary` (ein Bericht über mehrere
 * Jahre wird erst `review`, wenn alle abgeschlossen sind); sonst eine nicht stornierte festgeschriebene Fassung mit
 * gleichem Bericht, gleichen Parametern und gleichem Hash → `final`; sonst `review`.
 */
export function reportStageInternal(db: DbOrTx, def: ReportDefinition, params: ReportParams, hash: string, today: string): ReportStage {
  // Eine Arbeitsliste hat keine Prüffassung: Sie bleibt vorläufig (Designer Runde 6, 268).
  if (def.finalizable === false) return 'preliminary';
  // E6b: Ein Bericht über einen eigenen Zeitraum folgt dessen Ende, nicht dem Geschäftsjahr.
  const period = def.periodEnd?.(params);
  if (period) {
    if (today <= period.endsOn) return 'preliminary';
  } else {
    const years = reportYearsInternal(db, def, params);
    if (years.length === 0 || years.some((y) => fiscalYearStatusInternal(db, y.id) === 'open')) return 'preliminary';
  }
  const final = db
    .select({ id: financeReports.id })
    .from(financeReports)
    .where(and(eq(financeReports.reportKey, def.key), eq(financeReports.params, canonicalJson(params)), eq(financeReports.dataHash, hash), isNull(financeReports.voidedAt)))
    .get();
  return final ? 'final' : 'review';
}

/** Die geltende Freigabe des Jahres zum Festschreiben, `null` ohne oder nach dem Widerruf. */
export function releaseOfYearInternal(db: DbOrTx, fiscalYearId: string): ReportRelease | null {
  const row = db.select().from(financeReportReleases).where(and(eq(financeReportReleases.fiscalYearId, fiscalYearId), isNull(financeReportReleases.revokedAt))).get();
  return row ? { basis: row.basis, note: row.note, documentId: row.documentId, at: row.at, byUserId: row.byUserId } : null;
}

/** Berichte für MV, Prüfung und Arbeit werden erst nach der Kassenprüfung festgeschrieben; die fürs Finanzamt nicht (Spec § A). */
export const GROUPS_NEEDING_RELEASE: readonly ReportGroup[] = ['assembly', 'audit', 'work', 'public'];

/**
 * Die Freigabe eines Jahres lässt sich nicht mehr ändern, sobald ein nicht zurückgenommener Bericht auf ihr beruht
 * (Designer Runde 2, 11a Zustand 4). Ein Bericht fürs Finanzamt braucht sie nicht und sperrt sie darum nicht.
 */
export function releaseChangeableInternal(db: DbOrTx, fiscalYearId: string): boolean {
  const resting = db
    .select({ id: financeReports.id, releaseBasis: financeReports.releaseBasis })
    .from(financeReports)
    .where(and(eq(financeReports.fiscalYearId, fiscalYearId), isNull(financeReports.voidedAt)))
    .all()
    .some((r) => r.releaseBasis !== null);
  return !resting;
}

/**
 * Warum dieser Datenstand jetzt nicht festgeschrieben werden kann, oder `null` — die eine Prüfung für den Lauf
 * (Oberfläche: Satz und Knopf) und das Festschreiben. In und außerhalb der Transaktion.
 */
export function finalizeBlockInternal(db: DbOrTx, def: ReportDefinition, params: ReportParams, hash: string, data: unknown, today: string): ReportFinalizeBlock | null {
  if (def.finalizable === false) return { code: 'reportNotFinalizable', params: {} };
  const period = def.periodEnd?.(params);
  if (period) {
    // E6b: nach Ende des Zeitraums, ohne Jahresabschluss und ohne Kontoauszüge — die Voranmeldung ist am 10. fällig.
    if (today <= period.endsOn) return { code: 'reportPeriodOpen', params: { vatPeriod: period.key, endsOn: period.endsOn } };
  } else {
    const years = reportYearsInternal(db, def, params);
    const open = years.find((y) => fiscalYearStatusInternal(db, y.id) === 'open');
    if (years.length === 0 || open) return { code: 'reportYearOpen', params: { designation: open?.designation ?? '' } };
    if (GROUPS_NEEDING_RELEASE.includes(def.group)) {
      const missing = years.find((y) => !releaseOfYearInternal(db, y.id));
      if (missing) return { code: 'reportNotReleased', params: { designation: missing.designation } };
    }
    // Rechenschaft C Schritt 1: je Bankkonto der Auszug als PDF oder eine Begründung — für alle Gruppen (Joe 2026-10-24).
    for (const y of years) {
      const accounts = missingStatementPdfsInternal(db, y.id);
      if (accounts.length > 0) return { code: 'reportStatementsMissing', params: { designation: y.designation, accounts: accounts.map((a) => a.name).join(', '), count: accounts.length } };
    }
  }
  const same = db
    .select({ documentNumber: financeReports.documentNumber })
    .from(financeReports)
    .where(and(eq(financeReports.reportKey, def.key), eq(financeReports.params, canonicalJson(params)), eq(financeReports.dataHash, hash), isNull(financeReports.voidedAt)))
    .get();
  if (same) return { code: 'reportAlreadyFinal', params: { documentNumber: same.documentNumber } };
  return def.finalizeBlock?.(data) ?? null;
}
