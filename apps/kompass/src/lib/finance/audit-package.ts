import type { AuditSection, AuditSectionRow } from '@kompass/module-finance';

/**
 * Was die Spalte „Fortschritt“ des Prüfpakets zählt (Board 4a, 4e): je Abschnitt die Zahlen, aus denen die Übersicht
 * ihren Satz baut, und die offenen Vermerke an seinen Zeilen.
 */
export interface SectionSummary {
  section: AuditSection;
  counts: Record<string, number>;
  remarksOpen: number;
  /** Beantwortete Vermerke (Journal: an Buchungen, Designer Runde 8, 281) — nicht „offen“. */
  remarksAnswered?: number;
  /** Namen der Prüfer, die den Abschnitt durchgesehen haben. */
  reviewedBy: string[];
  reviewedByMe: boolean;
  /** Eine Durchsicht, die nach einer Änderung im Abschnitt nur noch für einen früheren Prüfstand gilt. */
  reviewedBefore: { names: string[]; at: string } | null;
}

const count = (rows: readonly AuditSectionRow[], test: (r: AuditSectionRow) => boolean) => rows.filter(test).length;
const param = (r: AuditSectionRow, key: string) => r.labelParams[key];

export function summarizeSection(section: AuditSection, rows: readonly AuditSectionRow[], opts: { samples: number }): Pick<SectionSummary, 'counts' | 'remarksOpen'> {
  const remarksOpen = rows.reduce((sum, r) => sum + r.remarksOpen, 0);
  const counts = ((): Record<string, number> => {
    switch (section) {
      case 'journal':
        return { samples: opts.samples };
      case 'reconciliation':
        return { off: count(rows, (r) => param(r, 'state') !== 'matches' && param(r, 'state') !== 'notReconcilable') };
      case 'vouchers':
        return {
          missing: count(rows, (r) => param(r, 'reason') === 'missing' || param(r, 'reason') === 'missingJustified'),
          own: count(rows, (r) => param(r, 'reason') === 'own'),
          withoutEntry: count(rows, (r) => param(r, 'reason') === 'withoutEntry'),
          revoked: count(rows, (r) => param(r, 'reason') === 'revoked'),
        };
      case 'imports':
        return { open: count(rows, (r) => param(r, 'kind') === 'open'), decisions: count(rows, (r) => param(r, 'kind') === 'decision') };
      case 'anomalies':
        return { total: rows.length };
      case 'purposesReserves':
        return { purposes: count(rows, (r) => r.kind === 'purpose'), reserves: count(rows, (r) => r.kind === 'reserve') };
      case 'donations':
        return { count: Number(rows.find((r) => param(r, 'kind') === 'total')?.labelParams.count ?? 0) };
      case 'partnerPayments':
        return { total: rows.length };
    }
  })();
  return { counts, remarksOpen };
}
