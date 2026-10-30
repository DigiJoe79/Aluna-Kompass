import type { FundsUseReport } from '@kompass/module-finance';

/**
 * Kopfsatz und Warnungen der Seite Mittelverwendung (Plan U2 Task 2; Designer Frage 4, Abnahme 12) — rein, ohne React.
 * Ob die zeitnahe Verwendung geboten ist, rechnet M1 (`head.obligation`, „nicht mehr als“ die Grenze ist freiwillig);
 * die Seite liest es nur. Gilt die Pflicht nicht, warnt sie nicht vor Fristen; der Verlust im wirtschaftlichen
 * Geschäftsbetrieb oder in der Vermögensverwaltung hängt nicht an der Grenze und warnt immer.
 */

export type FundsUseHeadCase = 'required' | 'voluntary' | 'noLimit';

export function fundsUseHead(head: FundsUseReport['head']): { case: FundsUseHeadCase; revenueCents: number; limitCents: number | null; assetSalesCents: number } {
  const headCase: FundsUseHeadCase = head.limitCents === null || head.noLimit ? 'noLimit' : head.obligation === 'required' ? 'required' : 'voluntary';
  return { case: headCase, revenueCents: head.revenueCents, limitCents: head.limitCents, assetSalesCents: head.assetSalesNotInRevenueCents };
}

export type FundsUseNotice =
  | { kind: 'deadlineMissed'; origin: string; restCents: number; dueBy: string }
  | { kind: 'loss'; sphere: 'business' | 'assetManagement'; cents: number }
  | { kind: 'endowmentWithOverhang' };

/**
 * Fristwarnungen nur bei `obligation === 'required'` und Vorträgen mit `state === 'overdue'`; Verlust immer (je Bereich
 * mit Betrag > 0); Vermögen nach § 62 Abs. 3 AO bei der Warnung aus M1. Reihenfolge: Frist, Verlust wGB, Verlust VV,
 * Vermögen.
 */
export function fundsUseNotices(report: FundsUseReport): FundsUseNotice[] {
  const { partA } = report;
  const notices: FundsUseNotice[] = [];
  if (report.head.obligation === 'required') {
    for (const b of partA.buckets) if (b.state === 'overdue') notices.push({ kind: 'deadlineMissed', origin: b.originDesignation, restCents: b.restCents, dueBy: b.dueBy });
  }
  if (partA.lossOffset.businessLossCents > 0) notices.push({ kind: 'loss', sphere: 'business', cents: partA.lossOffset.businessLossCents });
  if (partA.lossOffset.assetManagementLossCents > 0) notices.push({ kind: 'loss', sphere: 'assetManagement', cents: partA.lossOffset.assetManagementLossCents });
  if (partA.warnings.includes('endowmentWithOverhang')) notices.push({ kind: 'endowmentWithOverhang' });
  return notices;
}
