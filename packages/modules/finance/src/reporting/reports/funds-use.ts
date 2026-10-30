import { isoDay, notFound, paperDate, type DbOrTx, type Failure } from '@kompass/core';
import { z } from 'zod';
import { fundsUseOpeningViewsInternal, type FundsUseOpeningView } from '../../allocation/funds-use-openings';
import type { FundsUseBucket, FundsUseBucketState, FundsUseYearResult } from '../../allocation/funds-use-rules';
import { OPERATION_RESERVE_KINDS, SECTION_62_RESERVE_KINDS } from '../../allocation/reserve-rules';
import { formatEuro } from '../../format/amount';
import { valueAt } from '../../ledger/dated-values';
import { endowmentAtInternal } from '../../ledger/endowment';
import { assetOverviewAt } from '../../ledger/queries';
import { reserveBalancesAt } from '../../ledger/reserve-balances';
import { financeReserves } from '../../schema';
import { fiscalYearStatusInternal } from '../../ledger/fiscal-years';
import { fundsUseChainInternal } from '../funds-use-inputs';
import { annualRevenueForGemInternal } from '../revenue';
import type { ReportDefinition, ReportLinesFilter, ReportParams, ReportRenderContext } from '../types';
import { otherAssetsBlockInternal } from './asset-overview';
import { amountCell, emptyCell, heading, paragraph, reportYearInternal, small, strongAmountCell, strongCell, table, textCell, yearRowInternal, type ReportYear } from './common';
import { computeReserveStatementReport, reserveStatementTypst, type ReserveStatementReport } from './reserve-statement';

/**
 * Steuerliche Mittelverwendungsrechnung (M1 Task 4; Spec 0.4.5 Teil M, Spec 0.4.0 § „Mittelverwendungsrechnung“,
 * Prüfung `2026-10-28-spec-0-4-5-steuerrecht`): Kopf mit Einnahmen wie Anlage Gem Zeile 9, Grenze und ob die zeitnahe
 * Verwendung geboten ist; Teil A die Fortschreibung je Entstehungsjahr (`allocation/funds-use-rules.ts`); Teil B der
 * Abgleich mit dem Vermögen am Jahresende; Teil C der Rücklagenspiegel. Querformat. Bis M2 nicht freigeschaltet.
 */

/** Ein Anfangsvortrag im Bericht des ersten Jahres — ohne Beleg-ID und Fassung: Sie ändern den Datenstand nicht. */
export type FundsUseReportOpening = Omit<FundsUseOpeningView, 'documentId' | 'updatedAt'>;

export interface FundsUseReport {
  year: ReportYear;
  head: { revenueCents: number; limitCents: number | null; obligation: 'required' | 'voluntary'; noLimit: boolean; assetSalesNotInRevenueCents: number };
  partA: FundsUseYearResult;
  /** Nur im ersten Kompass-Jahr, sonst `null`. */
  openings: FundsUseReportOpening[] | null;
  partB: {
    date: string;
    accountsCents: number;
    receivablesCents: number;
    payablesCents: number;
    otherLiabilitiesCents: number;
    endowmentCents: number;
    section62ReservesCents: number;
    operationReservesCents: number;
    remainingCents: number;
    partAResultCents: number;
    differenceCents: number;
    otherAssetsCents: number;
    earmarkedCents: number;
    notCovered: readonly ['fixedAssets', 'loans', 'securities'];
  };
  partC: ReserveStatementReport;
}

const paramsSchema: z.ZodType<ReportParams> = z.object({ fiscalYearId: z.string().min(1) }).strict();

function checkParams(db: DbOrTx, params: ReportParams): Failure | null {
  return yearRowInternal(db, params.fiscalYearId!) ? null : notFound('financeFiscalYear', params.fiscalYearId!);
}

function partBOf(db: DbOrTx, date: string, partA: FundsUseYearResult): FundsUseReport['partB'] {
  const overview = assetOverviewAt(db, date);
  const accountsCents = overview.accounts.reduce((s, a) => s + a.balanceCents, 0);
  const other = otherAssetsBlockInternal(db, date);
  const endowmentCents = endowmentAtInternal(db, date);
  const kinds = new Map(db.select({ id: financeReserves.id, kind: financeReserves.kind }).from(financeReserves).all().map((r) => [r.id, r.kind]));
  let section62ReservesCents = 0;
  let operationReservesCents = 0;
  for (const b of reserveBalancesAt(db, date)) {
    const kind = kinds.get(b.reserveId)!;
    if (SECTION_62_RESERVE_KINDS.includes(kind)) section62ReservesCents += b.balanceCents;
    else if (OPERATION_RESERVE_KINDS.includes(kind)) operationReservesCents += b.balanceCents;
  }
  const remainingCents = accountsCents + overview.receivablesCents - overview.payablesCents - other.liabilitiesCents - endowmentCents - section62ReservesCents - operationReservesCents;
  const partAResultCents = partA.backlogCents - partA.overhangOutCents;
  return {
    date,
    accountsCents,
    receivablesCents: overview.receivablesCents,
    payablesCents: overview.payablesCents,
    otherLiabilitiesCents: other.liabilitiesCents,
    endowmentCents,
    section62ReservesCents,
    operationReservesCents,
    remainingCents,
    partAResultCents,
    differenceCents: remainingCents - partAResultCents,
    otherAssetsCents: other.assetsCents,
    earmarkedCents: overview.earmarkedCents,
    notCovered: ['fixedAssets', 'loans', 'securities'],
  };
}

export function computeFundsUseReport(db: DbOrTx, params: ReportParams): FundsUseReport {
  const year = reportYearInternal(db, params.fiscalYearId!);
  // Wie die Fristen (M2, Abnahme): Vorträge entfallen erst mit einem abgeschlossenen Jahr nicht über der Grenze. Ein
  // abgeschlossenes Jahr rechnet wie bisher (Hash festgeschriebener Fassungen unverändert).
  const chain = fundsUseChainInternal(db, year.id, { lapses: (id) => fiscalYearStatusInternal(db, id) === 'closed' });
  const partA = chain.at(-1)!;
  const first = chain.length === 1;
  return {
    year,
    head: { revenueCents: annualRevenueForGemInternal(db, year.id).totalCents, limitCents: (valueAt(db, 'thresholdTimelyUse', year.endsOn) as number | null) ?? null, obligation: partA.obligation, noLimit: partA.noLimit, assetSalesNotInRevenueCents: partA.a1.assetSalesCents },
    partA,
    openings: first ? fundsUseOpeningViewsInternal(db).map(({ documentId: _d, updatedAt: _u, ...rest }) => rest) : null,
    partB: partBOf(db, year.endsOn, partA),
    partC: computeReserveStatementReport(db, { fiscalYearId: year.id }),
  };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const day = (iso: string) => paperDate(isoDay(iso));
const euro = (cents: number) => formatEuro(cents);

const STATE_TEXT: Record<FundsUseBucketState, string> = { open: 'offen', overdue: 'Frist überschritten', lapsed: 'entfallen', used: 'verwendet' };
const ZERO_REASON_TEXT = { belowLimit: 'Einnahmen nicht über der Grenze (AEAO zu § 55 Nr. 31)', followedByYearBelowLimit: 'Folgejahr nicht über der Grenze (AEAO zu § 55 Nr. 31)' } as const;

const ASSUMPTIONS =
  'Annahmen: Verbraucht gelten die ältesten Mittel zuerst (AEAO zu § 55 Nr. 29). Ein Verwendungsüberhang wird vorgetragen und mit den nächsten Zuflüssen verrechnet. Erlöse aus Anlagenverkäufen zählen als zeitnah zu verwendende Mittel (AEAO zu § 55 Nr. 32), bei der Grenze dagegen nicht. Vermögen nach § 62 Abs. 3 AO ist die Summe der Zuführungen seit Beginn; einen Verbrauch kennt Kompass nicht. Anlagegüter, Darlehen und Wertpapiere kennt Kompass nicht; sie fehlen in Teil B.';

function originName(b: FundsUseBucket): string {
  return b.originKey.startsWith('opening:') ? `${b.originDesignation} (Anfangsvortrag)` : b.originDesignation;
}

function headTypst(data: FundsUseReport): string[] {
  const { head, year } = data;
  const parts: string[] = [];
  if (head.limitCents === null) {
    parts.push(paragraph(`Einnahmen ${year.designation}: ${euro(head.revenueCents)}. Für dieses Jahr gibt es keine Freigrenze; die Mittel sind bis zum Ende des übernächsten Jahres zu verwenden.`));
  } else if (head.obligation === 'required') {
    parts.push(paragraph(`Einnahmen ${year.designation} (wie Anlage Gem Zeile 9): ${euro(head.revenueCents)}. Über der Grenze von ${euro(head.limitCents)} sind die Mittel bis zum Ende des übernächsten Jahres zu verwenden (§ 55 Abs. 1 Nr. 5 AO); diese Rechnung ist der Nachweis (AEAO zu § 55 Nr. 29).`));
  } else {
    parts.push(paragraph(`Einnahmen ${year.designation} (wie Anlage Gem Zeile 9): ${euro(head.revenueCents)}. Nicht über der Grenze von ${euro(head.limitCents)} gilt die Pflicht zur zeitnahen Verwendung nicht; die Rechnung ist freiwillig (AEAO zu § 55 Nr. 31). Die Mittel sind weiterhin für die Satzungszwecke zu verwenden (§ 55 Abs. 1 Nr. 1 AO).`));
  }
  if (head.assetSalesNotInRevenueCents > 0) parts.push(paragraph(`Davon nicht in den Einnahmen der Grenze: Anlagenverkäufe ${euro(head.assetSalesNotInRevenueCents)}.`));
  return parts;
}

function partATypst(data: FundsUseReport): string[] {
  const a = data.partA;
  const sub = (label: string, cents: number) => [textCell(label), amountCell(cents)];
  const rows: string[][] = [
    [strongCell('A1 Zufluss zeitnah zu verwendender Mittel'), strongAmountCell(a.a1.totalCents)],
    sub(`Einnahmen ideeller Bereich (davon Anlagenverkäufe ${euro(a.a1.assetSalesCents)})`, a.a1.idealIncomeCents),
    sub('Überschuss Vermögensverwaltung', a.a1.assetManagementSurplusCents),
    sub('Überschuss Zweckbetriebe', a.a1.purposeOperationSurplusCents),
    sub('Gewinn wirtschaftlicher Geschäftsbetrieb', a.a1.businessSurplusCents),
    sub('Entnahmen und Auflösungen von Rücklagen', a.a1.reserveReleasesCents),
    [strongCell('A2 Satzungsgemäße Verwendung'), strongAmountCell(-a.a2.totalCents)],
    sub('Ausgaben ideeller Bereich', -a.a2.idealExpenseCents),
    sub('Verlust Zweckbetriebe', -a.a2.purposeOperationLossCents),
    [strongCell('Ausgleich Verlust wGB / VV aus anderen Mitteln'), strongAmountCell(-a.lossOffset.totalCents)],
    sub('Verlust wirtschaftlicher Geschäftsbetrieb', -a.lossOffset.businessLossCents),
    sub('Verlust Vermögensverwaltung', -a.lossOffset.assetManagementLossCents),
    [strongCell('A3 Zuführungen zu Rücklagen'), strongAmountCell(-a.a3.totalCents)],
    sub('im Jahr', -a.a3.reserveAllocationsCents),
    sub('nachträglich, über den Vortrag des Entstehungsjahres hinaus', -a.a3.lateExcessCents),
    [strongCell('A4 Rest des Jahres'), strongAmountCell(a.a4RestCents)],
    [textCell('Überhang aus dem Vorjahr'), amountCell(-a.overhangInCents)],
    [textCell('Überhang zum Jahresende (vorgetragen)'), amountCell(a.overhangOutCents)],
  ];
  const parts = [heading(2, `Teil A — Mittelverwendung ${data.year.designation}, in €`), table('(1fr, 36mm)', ['', 'Betrag'], rows, { rightHeads: [1] })];
  parts.push(small(`Nachrichtlich: Zuführungen zum Vermögen nach § 62 Abs. 3 AO im Jahr ${euro(a.endowmentCents)} — nicht in A1.`));

  parts.push(heading(2, 'Vorträge je Entstehungsjahr, in €'));
  parts.push(
    table(
      '(1fr, 28mm, 32mm, 28mm, 28mm, 30mm, 32mm)',
      ['Entstehungsjahr', 'Anfang', 'nachträglich zugeführt', 'verbraucht', 'Rest', 'zu verwenden bis', 'Stand'],
      a.buckets.map((b) => [textCell(originName(b)), amountCell(b.openingCents), amountCell(b.lateAllocationCents), amountCell(b.usedCents), amountCell(b.restCents), textCell(day(b.dueBy)), b.state === 'overdue' ? strongCell(STATE_TEXT[b.state]) : textCell(STATE_TEXT[b.state])]),
      { rightHeads: [1, 2, 3, 4] },
    ),
  );
  parts.push(paragraph(`Noch zu verwenden zum ${day(data.year.endsOn)}: ${euro(a.backlogCents)}.`));
  if (a.lapsedAtEnd) parts.push(paragraph(`Zum ${day(data.year.endsOn)} entfallen alle Vorträge (AEAO zu § 55 Nr. 31).`));
  // Offenes Jahr, bisher nicht über der Grenze: Die Vorträge stehen mit Frist, bis das Jahr abgeschlossen ist.
  else if (a.obligation === 'voluntary' && a.buckets.some((b) => b.originRequired && b.restCents > 0)) parts.push(paragraph(`Entfällt, wenn das Jahr ${data.year.designation} mit Einnahmen nicht über der Grenze abgeschlossen wird.`));
  const hint = (text: string) => `#block(inset: (y: 4pt))[*Hinweis:* ${paragraph(text)}]`;
  if (a.warnings.includes('lossOffset')) parts.push(hint('mögliche Mittelfehlverwendung (AEAO zu § 55 Nr. 4–9) — Ausnahme prüfen und begründen.'));
  if (a.warnings.includes('deadlineMissed')) {
    for (const b of a.buckets.filter((x) => x.state === 'overdue')) parts.push(paragraph(`Mittel aus ${originName(b)} waren bis ${day(b.dueBy)} zu verwenden. Das Finanzamt kann dafür eine Frist setzen (§ 63 Abs. 4 AO).`));
  }
  if (a.warnings.includes('endowmentWithOverhang')) parts.push(paragraph('Es gibt Vermögen nach § 62 Abs. 3 AO; ob ein Überhang daraus vorfinanziert werden durfte, ist zu prüfen.'));
  return parts;
}

function openingsTypst(openings: readonly FundsUseReportOpening[]): string[] {
  if (openings.length === 0) return [];
  return [
    heading(2, 'Anfangsvorträge aus der Zeit vor Kompass, in €'),
    table(
      '(26mm, 30mm, 30mm, 30mm, 30mm, 1fr)',
      ['Jahr', 'Einnahmen', 'Grenze', 'Betrag', 'wirksam', 'Grund'],
      openings.map((o) => [textCell(o.designation), amountCell(o.revenueCents), o.limitCents === null ? textCell('keine') : amountCell(o.limitCents), amountCell(o.amountCents), amountCell(o.effectiveCents), o.zeroReason ? textCell(ZERO_REASON_TEXT[o.zeroReason]) : emptyCell]),
      { rightHeads: [1, 2, 3, 4] },
    ),
  ];
}

/**
 * Teil B. Unter der Grenze (Vorträge zum Jahresende entfallen, `lapsedAtEnd`) rechnet Teil A 0; die Differenz ist dann
 * der entfallene Vortrag und heißt so, statt fett als unerklärte „Differenz“ dazustehen (Bildabnahme 0.4.5 W-5). Nur
 * Papier: Daten und Hash bleiben.
 */
function partBTypst(b: FundsUseReport['partB'], lapsedOn: string | null): string[] {
  const lapsed = lapsedOn !== null && b.differenceCents > 0;
  const rows: string[][] = [
    [textCell('Geldkonten'), amountCell(b.accountsCents)],
    [textCell('Offene Zahlungen an den Verein (Forderungen)'), amountCell(b.receivablesCents)],
    [textCell('Offene Zahlungen des Vereins (Verbindlichkeiten)'), amountCell(-b.payablesCents)],
    [textCell('Verpflichtungen (sonstige Werte)'), amountCell(-b.otherLiabilitiesCents)],
    [textCell('Vermögen nach § 62 Abs. 3 AO'), amountCell(-b.endowmentCents)],
    [textCell('Rücklagen nach § 62 AO'), amountCell(-b.section62ReservesCents)],
    [textCell('Rücklagen im wGB und in der Vermögensverwaltung (keine § 62-Rücklagen)'), amountCell(-b.operationReservesCents)],
    [strongCell('Noch zu verwenden laut Vermögen'), strongAmountCell(b.remainingCents)],
    [textCell('Noch zu verwenden laut Teil A (Rest abzüglich Überhang)'), amountCell(b.partAResultCents)],
    lapsed ? [textCell(`Zum ${day(lapsedOn!)} entfallen (AEAO zu § 55 Nr. 31)`), amountCell(b.differenceCents)] : [strongCell('Differenz'), strongAmountCell(b.differenceCents)],
  ];
  const parts = [heading(2, `Teil B — Abgleich mit dem Vermögen am ${day(b.date)}, in €`), table('(1fr, 36mm)', ['', 'Betrag'], rows, { rightHeads: [1] })];
  if (lapsed) parts.push(paragraph(`Die Einnahmen liegen nicht über der Grenze: Zum ${day(lapsedOn!)} entfallen alle Vorträge, die verbleibenden Mittel unterliegen keiner Verwendungsfrist (AEAO zu § 55 Nr. 31).`));
  else if (b.differenceCents !== 0) parts.push(paragraph('Die Differenz zu Teil A erklärt sich etwa aus Anfangsbeständen ohne Vortrag, Sachwerten oder entfallenen Vorträgen.'));
  parts.push(small(`Nachrichtlich, nicht abgezogen: sonstige Vermögensgegenstände ${euro(b.otherAssetsCents)} (zweckdienliche Gegenstände gelten als verwendet); davon zweckgebunden ${euro(b.earmarkedCents)} (ein Zweckbestand befreit nicht von der Frist). Nicht erfasst: Anlagegüter, Darlehen, Wertpapiere.`));
  return parts;
}

export function fundsUseTypst(data: FundsUseReport, ctx: ReportRenderContext): string {
  return [
    ...headTypst(data),
    ...partATypst(data),
    ...openingsTypst(data.openings ?? []),
    ...partBTypst(data.partB, data.partA.lapsedAtEnd ? data.year.endsOn : null),
    heading(2, 'Teil C — Rücklagenspiegel'),
    reserveStatementTypst(data.partC, ctx),
    paragraph(ASSUMPTIONS),
  ].join('\n\n');
}

function linesFilter(_data: FundsUseReport, params: ReportParams): Record<string, ReportLinesFilter> {
  return { idealIncome: { fiscalYearId: params.fiscalYearId!, sphere: 'ideal', direction: 'income' }, idealExpense: { fiscalYearId: params.fiscalYearId!, sphere: 'ideal', direction: 'expense' } };
}

export const fundsUseReport: ReportDefinition<FundsUseReport> = {
  key: 'fundsUse',
  group: 'taxOffice',
  personal: false,
  // M2: frei; über der Grenze Schritt 13, Prüfpaket und Verwendungsfrist (Spec 0.4.5 Teil M).
  available: true,
  orientation: 'landscape',
  paramsSchema,
  checkParams,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: computeFundsUseReport,
  toTypst: fundsUseTypst,
  titleKey: 'finance.reports.fundsUse.title',
  paperTitle: 'Mittelverwendungsrechnung',
  linesFilter,
};
