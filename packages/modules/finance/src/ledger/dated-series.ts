export type DatedUnit = 'cents' | 'percent' | 'centsPerKm' | 'months' | 'days' | 'taxation';

interface SeriesEntry { validFrom: string; value: number | string }
interface DatedSeriesDefinition { unit: DatedUnit; series: readonly SeriesEntry[] }

/**
 * Die ausgelieferte Reihe (Stand der Recherche vom 19.09.2026). Wächst mit
 * Updates — ein neues Gesetz ist eine neue Zeile, keine Migration. Eine
 * Überschreibung des Vereins sticht sie ab ihrem eigenen Stichtag
 * (`dated-values.ts`).
 */
export const DATED_SERIES = {
  // § 55 Abs. 1 Nr. 5 S. 4 AO i. d. F. StÄndG 2025
  thresholdTimelyUse: { unit: 'cents', series: [{ validFrom: '2026-01-01', value: 10000000 }] },
  // § 64 Abs. 3 AO
  thresholdBusiness: { unit: 'cents', series: [{ validFrom: '2026-01-01', value: 5000000 }] },
  // § 19 Abs. 1 UStG
  smallBusinessPrevYear: { unit: 'cents', series: [{ validFrom: '2025-01-01', value: 2500000 }] },
  // § 19 Abs. 1 UStG
  smallBusinessCurrentYear: { unit: 'cents', series: [{ validFrom: '2025-01-01', value: 10000000 }] },
  // § 3 Nr. 26a EStG
  allowanceVolunteer: { unit: 'cents', series: [{ validFrom: '2026-01-01', value: 96000 }] },
  // § 3 Nr. 26 EStG
  allowanceTrainer: { unit: 'cents', series: [{ validFrom: '2026-01-01', value: 330000 }] },
  // § 50 Abs. 4 EStDV
  simplifiedReceiptLimit: { unit: 'cents', series: [{ validFrom: '2021-01-01', value: 30000 }] },
  // Warnmarke
  warnAtPercent: { unit: 'percent', series: [{ validFrom: '2026-01-01', value: 80 }] },
  // § 9 Abs. 1 Nr. 4a EStG
  mileageRate: { unit: 'centsPerKm', series: [{ validFrom: '2026-01-01', value: 30 }] },
  // § 12 Abs. 1 UStG
  vatStandard: { unit: 'percent', series: [{ validFrom: '2007-01-01', value: 19 }] },
  // § 12 Abs. 2 UStG
  vatReduced: { unit: 'percent', series: [{ validFrom: '2007-01-01', value: 7 }] },
  // § 62 Abs. 1 Nr. 3 AO (ein Drittel; gerechnet wird mit 1/3, die Zahl dient der Anzeige)
  freeReserveAssetShare: { unit: 'percent', series: [{ validFrom: '2026-01-01', value: 33 }] },
  // § 62 Abs. 1 Nr. 3 AO
  freeReserveOtherShare: { unit: 'percent', series: [{ validFrom: '2026-01-01', value: 10 }] },
  // Verzichtsfrist laufende Ansprüche (BMF 25.11.2014)
  waiverClaimMonths: { unit: 'months', series: [{ validFrom: '2026-01-01', value: 3 }] },
  // Verzichtsfrist einmalige Ansprüche
  waiverOneOffMonths: { unit: 'months', series: [{ validFrom: '2026-01-01', value: 12 }] },
  // „spät festgeschrieben“, bar
  lateFinalizeCashDays: { unit: 'days', series: [{ validFrom: '2026-01-01', value: 1 }] },
  // Besteuerungsform, taggenau
  taxation: { unit: 'taxation', series: [{ validFrom: '2026-01-01', value: 'smallBusiness' }] },
} as const satisfies Record<string, DatedSeriesDefinition>;

export type DatedValueKey = keyof typeof DATED_SERIES;
