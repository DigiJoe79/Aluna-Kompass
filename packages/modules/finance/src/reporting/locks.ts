import { isoNow, type DbOrTx } from '@kompass/core';
import { and, eq, isNull } from 'drizzle-orm';
import { financeAudit } from '../audit';
import type { PeriodReopenGuard } from '../locks';
import { financeFiscalYears, financeReportReleases, financeReports } from '../schema';
import { reportDefinition } from './catalog';
import { voidReportInternal } from './finalize';
import type { ReportParams } from './types';

/**
 * Wiederöffnen eines Jahres (Spec § A „Wiederöffnen“): festgeschriebene Berichte, die das Jahr betreffen, werden
 * storniert — auch Berichte über mehrere Jahre, deren Zeitraum es enthält. Stornieren heißt nicht löschen: das
 * Dokument bleibt lesbar in der Akte, mit dem Grund des Wiederöffnens. Eingetragen in `manifest.ts`.
 */
function finalReportsOfYear(db: DbOrTx, yearId: string) {
  return db
    .select()
    .from(financeReports)
    .where(isNull(financeReports.voidedAt))
    .all()
    .filter((r) => {
      // E6b: Eine Voranmeldung hängt an ihrem Zeitraum, nicht am Abschluss — ein Wiederöffnen storniert sie nicht.
      if (reportDefinition(r.reportKey)?.periodEnd) return false;
      if (r.fiscalYearId === yearId) return true;
      const params = JSON.parse(r.params) as ReportParams;
      if (params.fiscalYearId === yearId || (params.fiscalYearIds ?? []).includes(yearId)) return true;
      // Ein Bericht über einen eigenen Zeitraum (Erklärungszeitraum, D2) nennt seine Jahre nur über den Katalog.
      return reportDefinition(r.reportKey)?.years(db, params).includes(yearId) ?? false;
    });
}

export const reportsReopenGuard: PeriodReopenGuard = {
  describe(db, yearId) {
    const count = finalReportsOfYear(db, yearId).length;
    return count > 0 ? { code: 'reportsVoided', params: { count } } : null;
  },
  onReopen(tx, deps, ctx, yearId, reason) {
    for (const report of finalReportsOfYear(tx, yearId)) voidReportInternal(tx, deps, ctx, report.id, reason);
  },
};

function activeRelease(db: DbOrTx, yearId: string) {
  return db.select().from(financeReportReleases).where(and(eq(financeReportReleases.fiscalYearId, yearId), isNull(financeReportReleases.revokedAt))).get() ?? null;
}

/** Die Freigabe zum Festschreiben gilt dem abgeschlossenen Jahr — wiedergeöffnet wird sie widerrufen (nicht gelöscht). */
export const releaseReopenGuard: PeriodReopenGuard = {
  describe(db, yearId) {
    return activeRelease(db, yearId) ? { code: 'releaseRevoked', params: {} } : null;
  },
  onReopen(tx, deps, ctx, yearId) {
    if (!activeRelease(tx, yearId)) return;
    const now = isoNow(deps.clock);
    tx.update(financeReportReleases).set({ revokedAt: now, revokedByUserId: ctx.userId ?? 'system' }).where(eq(financeReportReleases.fiscalYearId, yearId)).run();
    const designation = tx.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, yearId)).get()?.designation ?? '';
    financeAudit(tx, deps, ctx, { action: 'finance.report.releaseRevoke', entity: 'financeReportRelease', id: yearId, before: { fiscalYearId: yearId }, after: { fiscalYearId: yearId }, params: { designation } });
  },
};
