/** `ratio`: ein genauer Bruch als Text „Zähler/Nenner“ (etwa „1/3“), gerechnet ohne Rundung auf Prozent. */
export type DatedUnit = 'cents' | 'percent' | 'ratio' | 'centsPerKm' | 'months' | 'days' | 'taxation' | 'flag' | 'vatId' | 'vatAdvancePeriod' | 'federalState';

interface SeriesEntry { validFrom: string; value: number | string | boolean }
interface DatedSeriesDefinition { unit: DatedUnit; series: readonly SeriesEntry[] }

/**
 * Die ausgelieferte Reihe (Stand der Recherche vom 19.09.2026, Historie seit 24.10.2026). Wächst mit
 * Updates — ein neues Gesetz ist eine neue Zeile, keine Migration. Eine
 * Überschreibung des Vereins sticht sie ab ihrem eigenen Stichtag
 * (`dated-values.ts`).
 */
export const DATED_SERIES = {
  // § 55 Abs. 1 Nr. 5 S. 4 AO: 45.000 € ab 2021 (JStG 2020; Beginn 2020 oder 2021 unsicher, davor keine Grenze),
  // 100.000 € ab 2026 (StÄndG 2025)
  thresholdTimelyUse: { unit: 'cents', series: [{ validFrom: '2021-01-01', value: 4500000 }, { validFrom: '2026-01-01', value: 10000000 }] },
  // § 64 Abs. 3 AO: 35.000 € ab 2007 (Art. 97 § 1d EGAO, davor kein Wert), 45.000 € ab 2020 (JStG 2020), 50.000 € ab 2026
  thresholdBusiness: { unit: 'cents', series: [{ validFrom: '2007-01-01', value: 3500000 }, { validFrom: '2020-01-01', value: 4500000 }, { validFrom: '2026-01-01', value: 5000000 }] },
  // § 64 Abs. 3 S. 2 AO i. d. F. StÄndG 2025: Zweckbetriebe und wGB zusammengefasst darstellbar, erst ab 2026
  thresholdAllBusinessCombined: { unit: 'cents', series: [{ validFrom: '2026-01-01', value: 5000000 }] },
  // § 19 Abs. 1 UStG
  smallBusinessPrevYear: { unit: 'cents', series: [{ validFrom: '2025-01-01', value: 2500000 }] },
  // § 19 Abs. 1 UStG
  smallBusinessCurrentYear: { unit: 'cents', series: [{ validFrom: '2025-01-01', value: 10000000 }] },
  // § 3 Nr. 26a EStG: 720 € ab 2013 (Ehrenamtsstärkungsgesetz), 840 € ab 2021 (JStG 2020), 960 € ab 2026
  allowanceVolunteer: { unit: 'cents', series: [{ validFrom: '2013-01-01', value: 72000 }, { validFrom: '2021-01-01', value: 84000 }, { validFrom: '2026-01-01', value: 96000 }] },
  // § 3 Nr. 26 EStG: 2.400 € ab 2013, 3.000 € ab 2021, 3.300 € ab 2026
  allowanceTrainer: { unit: 'cents', series: [{ validFrom: '2013-01-01', value: 240000 }, { validFrom: '2021-01-01', value: 300000 }, { validFrom: '2026-01-01', value: 330000 }] },
  // § 31a BGB: Haftungsprivileg für Organmitglieder bis zu einer Vergütung von 840 € ab 2021, 3.300 € ab 2026
  organMemberLiabilityLimit: { unit: 'cents', series: [{ validFrom: '2021-01-01', value: 84000 }, { validFrom: '2026-01-01', value: 330000 }] },
  // § 50 Abs. 4 EStDV
  simplifiedReceiptLimit: { unit: 'cents', series: [{ validFrom: '2021-01-01', value: 30000 }] },
  // Warnmarke — ab 2000, damit auch Vorjahre ihren Schwellenwächter haben (Rechenschaft C)
  warnAtPercent: { unit: 'percent', series: [{ validFrom: '2000-01-01', value: 80 }] },
  // § 9 Abs. 1 S. 3 Nr. 4a S. 2 EStG (seit 2014, Reisekostenreform, Gesetz vom 20.02.2013) i. V. m. § 5 Abs. 2 BRKG:
  // 30 Cent je km (gesetze-im-internet.de, abgerufen 2026-10-25). Vor 2014 nicht abgebildet (damals R 9.5 LStR).
  mileageRate: { unit: 'centsPerKm', series: [{ validFrom: '2014-01-01', value: 30 }] },
  // § 12 Abs. 1 UStG
  vatStandard: { unit: 'percent', series: [{ validFrom: '2007-01-01', value: 19 }] },
  // § 12 Abs. 2 UStG
  vatReduced: { unit: 'percent', series: [{ validFrom: '2007-01-01', value: 7 }] },
  // § 62 Abs. 1 Nr. 3 AO: ein Drittel des Überschusses der Vermögensverwaltung — als genauer Bruch, nicht 33 %.
  // Gilt so seit 2000: § 58 Nr. 7 Buchst. a AO i. d. F. des Gesetzes vom 14.07.2000 (BGBl. I S. 1034; vorher ein Viertel),
  // anzuwenden ab 01.01.2000 (Art. 97 § 1a Abs. 3 EGAO, nachgelesen 2026-10-25); ab 2014 § 62 AO (Designer Runde 7, 262).
  freeReserveAssetShare: { unit: 'ratio', series: [{ validFrom: '2000-01-01', value: '1/3' }] },
  // § 62 Abs. 1 Nr. 3 AO: 10 % der sonstigen zeitnah zu verwendenden Mittel, ebenso seit 2000 (eingefügt mit dem Gesetz
  // vom 14.07.2000, Art. 97 § 1a Abs. 3 EGAO)
  freeReserveOtherShare: { unit: 'percent', series: [{ validFrom: '2000-01-01', value: 10 }] },
  // Verzichtsfrist regelmäßige Ansprüche (Tz. 3 BMF 25.11.2014, anzuwenden ab 01.01.2015, Tz. 7): „bei einer regelmäßigen
  // Tätigkeit alle drei Monate“; seit der Ergänzung vom 24.08.2016 (ohne Anwendungstag, ab Veröffentlichung) „innerhalb
  // eines Jahres nach Fälligkeit“ (EStH Anhang 37 III). Nachgelesen 2026-10-25 in den Schreiben selbst.
  waiverClaimMonths: { unit: 'months', series: [{ validFrom: '2015-01-01', value: 3 }, { validFrom: '2016-08-24', value: 12 }] },
  // Verzichtsfrist einmalige Ansprüche: drei Monate nach Fälligkeit (Tz. 3 BMF 25.11.2014, ab 01.01.2015)
  waiverOneOffMonths: { unit: 'months', series: [{ validFrom: '2015-01-01', value: 3 }] },
  // „spät festgeschrieben“, bar — keine Norm, Vorgabe Kompass; ab 2000 wie `warnAtPercent`, damit Vorjahre rechnen
  lateFinalizeCashDays: { unit: 'days', series: [{ validFrom: '2000-01-01', value: 1 }] },
  // Besteuerungsform, taggenau
  // Ab 2000, damit Vorjahre rechnen (Rechenschaft C, Claude); der Verein setzt seine Form mit Stichtag.
  taxation: { unit: 'taxation', series: [{ validFrom: '2000-01-01', value: 'smallBusiness' }] },
  // ── Einstellung „Umsatzsteuer“ (Spec E6 Teil 1): Werte des Vereins, ab 2000 mit der Vorgabe, damit Vorjahre rechnen.
  // Unternehmer im Sinne des § 2 UStG (nachhaltige Tätigkeit gegen Entgelt, UStAE 2.10); bei `regular` immer ja.
  vatEntrepreneur: { unit: 'flag', series: [{ validFrom: '2000-01-01', value: false }] },
  // USt-IdNr. des Vereins (§ 27a UStG); `''` heißt „keine ab diesem Tag“.
  vatId: { unit: 'vatId', series: [] },
  // Voranmeldungszeitraum (§ 18 Abs. 2 UStG): `auto` = Quartal, Monat ab 9.000 € Steuer im Vorjahr.
  vatAdvancePeriod: { unit: 'vatAdvancePeriod', series: [{ validFrom: '2000-01-01', value: 'auto' }] },
  // Befreiung von der Voranmeldung durch das Finanzamt (§ 18 Abs. 2 S. 3 UStG); nicht im Fall des § 18 Abs. 4a
  // (UStAE 18.2 Abs. 2), wirkt deshalb nur bei `regular`.
  vatAdvanceExempt: { unit: 'flag', series: [{ validFrom: '2000-01-01', value: false }] },
  // Dauerfristverlängerung um einen Monat (§§ 46–48 UStDV).
  vatPermanentExtension: { unit: 'flag', series: [{ validFrom: '2000-01-01', value: false }] },
  // Bundesland des Finanzamts, für die Landesfeiertage am Fristende (§ 108 Abs. 3 AO); `''` = nur bundesweite Feiertage.
  taxOfficeState: { unit: 'federalState', series: [] },
} as const satisfies Record<string, DatedSeriesDefinition>;

export type DatedValueKey = keyof typeof DATED_SERIES;
