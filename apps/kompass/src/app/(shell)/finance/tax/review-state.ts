import type { TaxPeriodDocumentSlot, TaxPeriodView } from '@kompass/module-finance';

/**
 * B9 (Spec 0.5.2 § 6): der Hinweis über den Werten nach der Abgabe — welcher gilt, rechnet `reviewNoticeKind` rein.
 * - `review`: Prüfanlass offen (`Notice warn`) mit den geänderten Stellen und der Pflicht nach § 153 AO, ohne Entwarnung.
 * - `unchanged`: die abgegebene Fassung ist storniert, die Werte sind gleich (`Notice hint`, Steuerrecht M1).
 * - `unknown`: storniert, und der Maßstab hat kein Abbild (Abgabe vor 0.5.2) — Kompass kennt die Werte nicht.
 */
export type ReviewNoticeKind = 'review' | 'unchanged' | 'unknown';

export function reviewNoticeKind(period: Pick<TaxPeriodView, 'filedOn' | 'reviewDue' | 'filedFiguresMissing'>, retracted: boolean): ReviewNoticeKind | null {
  if (period.filedOn === null) return null;
  if (period.reviewDue) return 'review';
  if (!retracted) return null;
  return period.filedFiguresMissing ? 'unknown' : 'unchanged';
}

/**
 * Die Dokumentzeilen der Abgabe gehören zur letzten Abgabe (§ 6): nach einer Berichtigung deren Fächer, sonst die des
 * Zeitraums. Wohin „Ablegen …“ legt, sagt `target`.
 */
export type FilingDocuments = { target: 'period'; documents: TaxPeriodView['documents'] } | { target: 'amendment'; amendmentId: string; documents: TaxPeriodView['amendments'][number]['documents'] };

export function filingDocumentsOf(period: Pick<TaxPeriodView, 'documents' | 'amendments'>): FilingDocuments {
  const last = period.amendments.at(-1);
  return last ? { target: 'amendment', amendmentId: last.id, documents: last.documents } : { target: 'period', documents: period.documents };
}

/** Wohin ein Dokument der Abgabe geht: an den Zeitraum, an eine Berichtigung oder an die Anzeige des laufenden Anlasses. */
export type FilingSlot = { slot: TaxPeriodDocumentSlot; target?: 'period' } | { slot: 'filedReturn' | 'transmissionProtocol'; target: 'amendment'; amendmentId: string } | { slot: 'notice'; target: 'notice' };
