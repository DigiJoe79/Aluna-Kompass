import type { PeriodCloseHook, PeriodReopenGuard } from '../locks';
import { lastFiledReportInternal } from './report';
import { carryOverForBaselineInternal } from './carry-over';
import { baselineFiledInternal, ensureBaselineInternal, latestBaselineInternal } from './baseline';

/**
 * Abschluss eines Jahres (Spec § D1 „Prüfstand“): Ohne Prüfstand entsteht der erste (`initial`). Nach einem
 * Wiederöffnen entsteht ein neuer (`followUp`) nur, wenn auf dem letzten schon ein Bericht abgelegt war — sonst bleibt
 * der Entwurf am vorhandenen Stand und zeigt die Änderungen. Eingetragen in `manifest.ts`.
 */
export const auditBaselineCloseHook: PeriodCloseHook = {
  onClose(tx, deps, ctx, yearId) {
    const latest = latestBaselineInternal(tx, yearId);
    if (!latest) ensureBaselineInternal(tx, deps, ctx, yearId, 'initial');
    // Rechenschaft C: Auch eine Übernahme ins Folgejahr hat den Prüfstand erledigt — nach erneutem Wiederöffnen ein neuer.
    else if (baselineFiledInternal(tx, latest.id) || carryOverForBaselineInternal(tx, latest.id)) ensureBaselineInternal(tx, deps, ctx, yearId, 'followUp');
  },
};

/**
 * Wiederöffnen nach abgelegtem Prüfbericht (Spec § D1): Der Bericht bleibt, die Kassenprüfung steht wieder auf
 * „Nachprüfung offen“ — die Vorschau des Wiederöffnens sagt es. Zu tun ist nichts: Der nächste Abschluss legt den
 * Prüfstand der Nachprüfung an, Stichproben an geänderten Buchungen stehen auf „erneut prüfen“.
 */
export const auditFollowUpReopenGuard: PeriodReopenGuard = {
  describe(db, yearId) {
    return lastFiledReportInternal(db, yearId) ? { code: 'auditFollowUpNeeded', params: {} } : null;
  },
  onReopen() {},
};
