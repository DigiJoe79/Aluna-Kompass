/**
 * Reine Rechnung der Mittelverwendung (Fortschreibung Teil A, M1 Task 1) — ohne Imports wie
 * `allocation/reserve-rules.ts`, damit Dienst, Bericht und später die Oberfläche dieselbe Rechnung benutzen.
 *
 * Rechenregeln (Spec 0.4.5 Teil M „Rechenregeln nach Prüfung“, Prüfung `2026-10-28-spec-0-4-5-steuerrecht`):
 * - A1 = ideeller Bereich (mit Anlagenverkauf, AEAO zu § 55 Nr. 32; ohne Zuführung zum Vermögen) + Überschüsse
 *   Vermögensverwaltung, Zweckbetrieb, wGB + Entnahmen und Auflösungen von Rücklagen im Jahr (F-1: sonst zählt
 *   Ausgegebenes aus einer Rücklage doppelt).
 * - A2 = Ausgaben ideeller Bereich + Verlust Zweckbetrieb (F-3: Zweckbetrieb netto, Verlust = Verwendung).
 * - Verluste im einheitlichen wGB (§ 64 Abs. 2 AO) und in der Vermögensverwaltung sind eine eigene Zeile
 *   „Ausgleich aus anderen Mitteln“, keine Verwendung, mit Warnung (F-2, AEAO zu § 55 Nr. 4–9) — auch unter der Grenze.
 * - A3 = Zuführungen zu Rücklagen im Jahr; eine nachträgliche Zuführung für ein früheres Jahr (§ 62 Abs. 2 AO) mindert
 *   den Vortrag ihres Entstehungsjahres, der Überschuss geht in A3 (L-3). A4 = A1 − A2 − Ausgleich − A3.
 * - Verbrauch „älteste zuerst“ über die Vorträge, dann über A1 des Jahres (H-5, AEAO zu § 55 Nr. 29, Globalbetrachtung);
 *   ein Überhang wird vorgetragen und mit späteren Zuflüssen verrechnet (L-5, Annahme).
 * - Jahr nicht über der Grenze (≤, „nicht mehr als“): alle Vorträge entfallen zum Jahresende, das Folgejahr beginnt mit
 *   Vortrag 0 (F-4, AEAO zu § 55 Nr. 31). `limitCents === null` (vor 2021) heißt: keine Freigrenze, das Gebot gilt.
 * - Anfangsvortrag nur für die zwei Jahre vor dem ersten Kompass-Jahr; aus einem Jahr nicht über der damaligen Grenze
 *   oder vor einem solchen Jahr wirkt er mit 0 (L-4).
 */

export interface FundsUseYearInput {
  fiscalYearId: string;
  designation: string;
  endsOn: string;
  /** `annualRevenueForGemInternal(...).totalCents` — dieselbe Zahl wie Anlage Gem Zeile 9. */
  revenueCents: number;
  /** Freigrenze (`thresholdTimelyUse`) am `endsOn`; `null` = keine Freigrenze. */
  limitCents: number | null;
  /** Ideeller Bereich, Einnahmen ohne Zuführung zum Vermögen, mit Anlagenverkauf. */
  idealIncomeCents: number;
  /** Davon Anlagenverkauf (alle Bereiche), nachrichtlich. */
  assetSalesCents: number;
  /** Zuführungen zum Vermögen aller Bereiche im Jahr, nachrichtlich, nie in A1. */
  endowmentCents: number;
  /** Ergebnis Vermögensverwaltung ohne Zuführungen zum Vermögen, mit Vorzeichen. */
  assetManagementResultCents: number;
  purposeOperationResultCents: number;
  /** Einheitlicher wGB (§ 64 Abs. 2 AO): Summe der Sphäre. */
  businessResultCents: number;
  /** Positiv. */
  idealExpenseCents: number;
  /** Entnahmen und Auflösungen im Jahr, alle Arten. */
  reserveReleasesCents: number;
  /** Zuführungen im Jahr ohne Bezugsjahr oder mit dem eigenen Jahr. */
  reserveAllocationsCents: number;
  /** Zuführungen im Jahr für ein früheres Jahr (nachträgliche Bildung). */
  lateAllocations: { originKey: string; cents: number }[];
}

export interface FundsUseOpeningInput {
  offset: 1 | 2;
  designation: string;
  endsOn: string;
  revenueCents: number;
  amountCents: number;
  limitCents: number | null;
}

export type FundsUseZeroReason = 'belowLimit' | 'followedByYearBelowLimit';

export interface FundsUseOpeningEffect {
  offset: 1 | 2;
  effectiveCents: number;
  zeroReason: FundsUseZeroReason | null;
  dueBy: string;
}

export type FundsUseBucketState = 'open' | 'overdue' | 'lapsed' | 'used';

export interface FundsUseBucket {
  /** `fy:<id>` oder `opening:<offset>`. */
  originKey: string;
  originDesignation: string;
  originEndsOn: string;
  dueBy: string;
  originRequired: boolean;
  /** Stand zu Beginn des Jahres (beim eigenen Jahr: der Zufluss A1, mindestens 0). */
  openingCents: number;
  lateAllocationCents: number;
  usedCents: number;
  restCents: number;
  state: FundsUseBucketState;
}

export interface FundsUseYearResult {
  fiscalYearId: string;
  obligation: 'required' | 'voluntary';
  noLimit: boolean;
  a1: { idealIncomeCents: number; assetSalesCents: number; assetManagementSurplusCents: number; purposeOperationSurplusCents: number; businessSurplusCents: number; reserveReleasesCents: number; totalCents: number };
  a2: { idealExpenseCents: number; purposeOperationLossCents: number; totalCents: number };
  lossOffset: { businessLossCents: number; assetManagementLossCents: number; totalCents: number };
  a3: { reserveAllocationsCents: number; lateExcessCents: number; totalCents: number };
  /** a1 − a2 − lossOffset − a3. */
  a4RestCents: number;
  endowmentCents: number;
  overhangInCents: number;
  overhangOutCents: number;
  /** Älteste zuerst, das eigene Jahr zuletzt. */
  buckets: FundsUseBucket[];
  /** Σ restCents nach dem Jahr; 0 bei `lapsedAtEnd`. */
  backlogCents: number;
  lapsedAtEnd: boolean;
  warnings: ('lossOffset' | 'deadlineMissed' | 'endowmentWithOverhang')[];
}

/** Gleicher Tag `years` Jahre später (oder früher); der 29.02. wird in einem Gemeinjahr zum 28.02. */
export function addYearsToDay(day: string, years: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const year = y + years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dd = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Pflicht zur zeitnahen Verwendung nur über der Grenze (§ 55 Abs. 1 Nr. 5 S. 4 AO „nicht mehr als“); ohne Grenze immer. */
export function fundsUseObligation(revenueCents: number, limitCents: number | null): 'required' | 'voluntary' {
  return limitCents === null || revenueCents > limitCents ? 'required' : 'voluntary';
}

/** Wirkung der Anfangsvorträge (Prüfung L-4, AEAO zu § 55 Nr. 31). */
export function fundsUseOpeningEffects(openings: readonly FundsUseOpeningInput[]): FundsUseOpeningEffect[] {
  const below = (o: FundsUseOpeningInput): boolean => fundsUseObligation(o.revenueCents, o.limitCents) === 'voluntary';
  const first = openings.find((o) => o.offset === 1);
  return [...openings]
    .sort((a, b) => a.offset - b.offset)
    .map((o) => {
      const zeroReason: FundsUseZeroReason | null = below(o) ? 'belowLimit' : o.offset === 2 && first && below(first) ? 'followedByYearBelowLimit' : null;
      return { offset: o.offset, effectiveCents: zeroReason ? 0 : o.amountCents, zeroReason, dueBy: addYearsToDay(o.endsOn, 2) };
    });
}

/**
 * Wahl der Fortschreibung: `lapses(fiscalYearId)` sagt, ob ein Jahr nicht über der Grenze seine Vorträge zum Ende
 * streicht (Vorgabe: immer). Die Finanzfristen (M2) lassen ein noch offenes Jahr nicht streichen — die Frist eines
 * Rückstands endet erst mit dem Abschluss eines Jahres nicht über der Grenze (Spec 0.4.5 Entscheidung 4, Prüfung F-4).
 */
export interface FundsUseChainOptions {
  lapses?: (fiscalYearId: string) => boolean;
}

/** Fortschreibung vom ersten Jahr (mit den Anfangsvorträgen) bis zum letzten der übergebenen Jahre, in deren Reihenfolge. */
export function fundsUseChain(years: readonly FundsUseYearInput[], openings: readonly FundsUseOpeningInput[], opts: FundsUseChainOptions = {}): FundsUseYearResult[] {
  const effects = fundsUseOpeningEffects(openings);
  let carried: FundsUseBucket[] = [...openings]
    .sort((a, b) => b.offset - a.offset)
    .flatMap((o) => {
      const e = effects.find((x) => x.offset === o.offset)!;
      if (e.effectiveCents <= 0) return [];
      return [{ originKey: `opening:${o.offset}`, originDesignation: o.designation, originEndsOn: o.endsOn, dueBy: e.dueBy, originRequired: true, openingCents: e.effectiveCents, lateAllocationCents: 0, usedCents: 0, restCents: e.effectiveCents, state: 'open' as const }];
    });
  let overhang = 0;
  let endowmentSoFar = 0;
  const results: FundsUseYearResult[] = [];

  for (const y of years) {
    const obligation = fundsUseObligation(y.revenueCents, y.limitCents);
    endowmentSoFar += y.endowmentCents;
    const a1 = {
      idealIncomeCents: y.idealIncomeCents,
      assetSalesCents: y.assetSalesCents,
      assetManagementSurplusCents: Math.max(0, y.assetManagementResultCents),
      purposeOperationSurplusCents: Math.max(0, y.purposeOperationResultCents),
      businessSurplusCents: Math.max(0, y.businessResultCents),
      reserveReleasesCents: y.reserveReleasesCents,
      totalCents: 0,
    };
    a1.totalCents = a1.idealIncomeCents + a1.assetManagementSurplusCents + a1.purposeOperationSurplusCents + a1.businessSurplusCents + a1.reserveReleasesCents;
    const purposeOperationLossCents = Math.max(0, -y.purposeOperationResultCents);
    const a2 = { idealExpenseCents: y.idealExpenseCents, purposeOperationLossCents, totalCents: y.idealExpenseCents + purposeOperationLossCents };
    const businessLossCents = Math.max(0, -y.businessResultCents);
    const assetManagementLossCents = Math.max(0, -y.assetManagementResultCents);
    const lossOffset = { businessLossCents, assetManagementLossCents, totalCents: businessLossCents + assetManagementLossCents };

    const buckets: FundsUseBucket[] = carried.map((b) => ({ ...b, openingCents: b.restCents, lateAllocationCents: 0, usedCents: 0 }));
    let lateExcessCents = 0;
    for (const late of y.lateAllocations) {
      const b = buckets.find((x) => x.originKey === late.originKey);
      const taken = b ? Math.min(Math.max(0, late.cents), b.restCents) : 0;
      if (b) {
        b.lateAllocationCents += taken;
        b.restCents -= taken;
      }
      lateExcessCents += late.cents - taken;
    }
    const a3 = { reserveAllocationsCents: y.reserveAllocationsCents, lateExcessCents, totalCents: y.reserveAllocationsCents + lateExcessCents };
    const a4RestCents = a1.totalCents - a2.totalCents - lossOffset.totalCents - a3.totalCents;

    const own: FundsUseBucket = {
      originKey: `fy:${y.fiscalYearId}`,
      originDesignation: y.designation,
      originEndsOn: y.endsOn,
      dueBy: addYearsToDay(y.endsOn, 2),
      originRequired: obligation === 'required',
      openingCents: Math.max(0, a1.totalCents),
      lateAllocationCents: 0,
      usedCents: 0,
      restCents: Math.max(0, a1.totalCents),
      state: 'open',
    };
    buckets.push(own);

    const overhangInCents = overhang;
    let outflow = a2.totalCents + lossOffset.totalCents + a3.totalCents + overhangInCents + Math.max(0, -a1.totalCents);
    for (const b of buckets) {
      const used = Math.min(outflow, b.restCents);
      b.usedCents += used;
      b.restCents -= used;
      outflow -= used;
    }

    const warnings: FundsUseYearResult['warnings'] = [];
    if (lossOffset.totalCents > 0) warnings.push('lossOffset');
    const lapsedAtEnd = obligation === 'voluntary' && (opts.lapses?.(y.fiscalYearId) ?? true);
    const overhangOutCents = lapsedAtEnd ? 0 : outflow;
    for (const b of buckets) {
      if (lapsedAtEnd) b.state = 'lapsed';
      else if (b.restCents === 0) b.state = 'used';
      else if (b.dueBy <= y.endsOn) b.state = 'overdue';
      else b.state = 'open';
    }
    if (buckets.some((b) => b.state === 'overdue')) warnings.push('deadlineMissed');
    if (overhangOutCents > 0 && endowmentSoFar > 0) warnings.push('endowmentWithOverhang');
    const backlogCents = lapsedAtEnd ? 0 : buckets.reduce((s, b) => s + b.restCents, 0);

    results.push({ fiscalYearId: y.fiscalYearId, obligation, noLimit: y.limitCents === null, a1, a2, lossOffset, a3, a4RestCents, endowmentCents: y.endowmentCents, overhangInCents, overhangOutCents, buckets, backlogCents, lapsedAtEnd, warnings });
    carried = lapsedAtEnd ? [] : buckets.filter((b) => b.restCents > 0).map((b) => ({ ...b }));
    overhang = overhangOutCents;
  }
  return results;
}
