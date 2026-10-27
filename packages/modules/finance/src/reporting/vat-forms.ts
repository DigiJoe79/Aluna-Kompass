import { euroBase, type VatFigureSource } from '../ledger/vat-figure-sources';

/**
 * Kennzahlen der Umsatzsteuer-Voranmeldung und der Umsatzsteuer-Jahreserklärung (Spec E6 Teil 5, Plan E6b Task 3) — als
 * Code je Fassung, nicht als Einstellung, weil den Vordruck der Gesetzgeber ändert, nicht der Verein. Muster wie
 * `gem-forms.ts`: rein (läuft auch im Browser, `@kompass/module-finance/vat-forms`). Der Wortlaut ist Text des Vordrucks,
 * deutsch (Prinzip 7); er geht nie in die gehashten Daten eines Berichts — dort stehen nur Werte je Quelle.
 *
 * Kompass kennt nur die Sätze 19 % und 7 %: Kennzahlen zu anderen Sätzen (35/36, 95/98) und zum Satz 0 % fehlen.
 *
 * Fundstellen (abgerufen 25.10.2026):
 * - Voranmeldung 2025: BMF-Schreiben vom 09.12.2024, III C 3 - S 7344/19/10001 :006, DOK 2024/1007955, Muster USt 1 A 2025
 *   und Anleitung USt 1 E 2025 als Anlagen (Abschrift des BMF-PDF bei der IHK Nordschwarzwald,
 *   ihk.de/blueprint/servlet/resource/blob/6400472/bc934557732312a666cc8bf4e60ae0c8/bmf-schreiben-vom-09122024-data.pdf,
 *   abgerufen 26.10.2026; die BMF-Adresse …/2024-12-09-voranmeldungs-vorauszahlungsverf-2025.pdf antwortet 404). Zeilen
 *   und Kennzahlen aller Quellen gleich wie 2026: 10 (Kz 10), 13 (81), 14 (86), 23 (48, „z. B. Umsätze nach § 4 Nummer 8
 *   bis 29 oder § 19 Absatz 1 UStG“), 25 (89), 26 (93), 30 (46/47), 32 (84/85), 38 (66), 39 (61), 41 (67), 50 (83).
 *   Abweichungen zu 2026 nur außerhalb der Kurzlabels: Zeile 22 ohne „Umsätze nach Verordnungen der EU“, Zeilen 38/47
 *   nennen § 13a Absatz 1 Nummer 6 statt § 27 Absatz 40a UStG.
 * - Voranmeldung 2026: BMF-Schreiben vom 29.12.2025, III C 3 - S 7344/00039/007/036, Muster USt 1 A 2026 und Anleitung
 *   USt 1 E (Abschrift collmex.de/ust_voranmeldung.pdf, Zeilen 10, 13, 14, 23, 25, 26, 30, 32, 38, 39, 41, 50).
 *   Zeile 23 (Kz 48) nimmt die steuerfreien Umsätze ohne Vorsteuerabzug „nach § 4 Nummer 8 bis 29 oder § 19 Absatz 1
 *   UStG“ auf — bei Regelbesteuerung also beide Kennzeichen `exemptCounted` und `exemptNotCounted`.
 * - Jahreserklärung 2025: BMF-Schreiben vom 09.12.2024, III C 3 - S 7344/19/10002 :007, Muster USt 2 A 2025 (Abschrift
 *   collmex.de/ust_erklaerung.pdf): Zeilen 22 (Kz 177), 25 (275), 47 (287, nicht zum Gesamtumsatz), 48 (236, § 19),
 *   49 (240, zum Gesamtumsatz), 51/52 (781/793), 65 (846/847), 67 (877/878), 79 (320), 80 (761), 83 (467), 118 (816).
 * - Jahreserklärung 2026: BMF-Schreiben vom 29.12.2025, III C 3 - S 7344/00040/008/034 (BStBl 2025 I S. 2126), Muster
 *   USt 2 A 2026 (PDF des BMF, gelesen 26.10.2026, Recherche `2026-10-26-paragraph-52-und-ust-2a-2026`): die Kennzahlen
 *   von 2025 mit gleichem Wortlaut, nur die Zeilen verschoben — 24 (177), 27 (275), 52 (287), 53 (236), 54 (240), 57/58
 *   (781/793), 71 (846/847), 73 (877/878), 85 (320), 86 (761), 89 (467), 124 (816). Neue Felder (Kz 500, Reiseleistungen,
 *   Differenzbesteuerung, Dreiecksgeschäft, § 27 Abs. 40a) betreffen Kompass nicht.
 */

export type VatFormKind = 'advance' | 'annual';
export type { VatFigureSource };
export type VatFigureGroup = 'general' | 'ownSupplies' | 'acquisition' | 'reverseCharge' | 'inputTax' | 'result';

export interface VatFigure {
  code: string;
  group: VatFigureGroup;
  label: string;
  /** `euro`: Bemessungsgrundlage in vollen Euro; `cents`: Steuer mit Cent; `flag`: 1 = Ja. */
  unit: 'euro' | 'cents' | 'flag';
  source: VatFigureSource;
  /** Nur bei dieser Besteuerungsform; ohne Angabe bei beiden. */
  taxation?: 'regular' | 'smallBusiness';
  help?: string;
}

export interface VatForm {
  kind: VatFormKind;
  validFromYear: number;
  figures: readonly VatFigure[];
  /** Das Muster dieses Jahres kennt Kompass noch nicht; es nimmt die Kennzahlen der Vorfassung an. */
  assumed?: true;
  notes: readonly string[];
  /** Ein Satz nur für eine Besteuerungsform (Designer Runde 8, 340: „Kz 67 über Kz 83“ sagt einem Kleinunternehmer nichts). */
  taxationNotes?: Partial<Record<'regular' | 'smallBusiness', string>>;
}

/** Die Fußnoten eines Musters für eine Besteuerungsform: die allgemeinen, dann die eigene. */
export function vatFormNotes(form: Pick<VatForm, 'notes' | 'taxationNotes'> | null | undefined, taxation: 'regular' | 'smallBusiness'): string[] {
  if (!form) return [];
  const own = form.taxationNotes?.[taxation];
  return own ? [...form.notes, own] : [...form.notes];
}

export const VAT_FIGURE_GROUP_TITLES: Record<VatFigureGroup, string> = {
  general: 'Allgemeine Angaben',
  ownSupplies: 'Eigene Umsätze',
  acquisition: 'Innergemeinschaftliche Erwerbe',
  reverseCharge: 'Steuerschuldner ist der Verein (§ 13b)',
  inputTax: 'Abziehbare Vorsteuer',
  result: 'Ergebnis',
};

const RC_EU = 'Sonstige Leistungen nach § 3a Absatz 2 UStG eines im übrigen Gemeinschaftsgebiet ansässigen Unternehmers (§ 13b Absatz 1 UStG)';
const RC_OTHER = 'Andere Leistungen (§ 13b Absatz 2 Nummer 1, 2, 4 bis 12 UStG)';
const NOTE_ONLY_WITH_VALUE = 'Nur Kennzahlen mit Wert; die übrigen bleiben in ELSTER leer.';

const ADVANCE_FIGURES: readonly VatFigure[] = [
  { code: '10', group: 'general', label: 'Berichtigte Anmeldung', unit: 'flag', source: 'amended' },
  { code: '81', group: 'ownSupplies', label: 'Steuerpflichtige Umsätze zum Steuersatz von 19 %, Bemessungsgrundlage', unit: 'euro', source: 'ownStandardBase', taxation: 'regular' },
  { code: '86', group: 'ownSupplies', label: 'Steuerpflichtige Umsätze zum Steuersatz von 7 %, Bemessungsgrundlage', unit: 'euro', source: 'ownReducedBase', taxation: 'regular' },
  { code: '48', group: 'ownSupplies', label: 'Steuerfreie Umsätze ohne Vorsteuerabzug (§ 4 Nummer 8 bis 29 UStG)', unit: 'euro', source: 'exemptTurnover', taxation: 'regular' },
  // Hilfe zu Kz 48 beim Kleinunternehmer: Anleitung USt 1 E 2026 (BMF 29.12.2025, s. o.) zu Zeilen 19 bis 23 — „Tragen
  // Sie die nach § 19 Absatz 1 UStG steuerfreien Umsätze bitte in Zeile 23 ein“, ohne Ausnahme für den Fall des § 18
  // Abs. 4a; ebenso BMF 09.12.2024 Tz. 2. Ohne Einfluss auf die Steuer (Recherche 2026-10-26 B.2, Befund 37).
  { code: '48', group: 'ownSupplies', label: 'Steuerfreie Umsätze ohne Vorsteuerabzug (§ 19 Absatz 1 UStG)', unit: 'euro', source: 'smallBusinessTurnover', taxation: 'smallBusiness', help: 'Laut Anleitung zu Zeile 23 gehören die Umsätze nach § 19 Abs. 1 hierher. Sie ändern die Steuer nicht.' },
  { code: '89', group: 'acquisition', label: 'Steuerpflichtige innergemeinschaftliche Erwerbe zum Steuersatz von 19 %, Bemessungsgrundlage', unit: 'euro', source: 'acquisitionStandardBase' },
  { code: '93', group: 'acquisition', label: 'Steuerpflichtige innergemeinschaftliche Erwerbe zum Steuersatz von 7 %, Bemessungsgrundlage', unit: 'euro', source: 'acquisitionReducedBase' },
  { code: '46', group: 'reverseCharge', label: `${RC_EU}, Bemessungsgrundlage`, unit: 'euro', source: 'rc13bEuBase' },
  { code: '47', group: 'reverseCharge', label: 'Steuer dazu', unit: 'cents', source: 'rc13bEuTax' },
  { code: '84', group: 'reverseCharge', label: `${RC_OTHER}, Bemessungsgrundlage`, unit: 'euro', source: 'rc13bOtherBase' },
  { code: '85', group: 'reverseCharge', label: 'Steuer dazu', unit: 'cents', source: 'rc13bOtherTax' },
  { code: '66', group: 'inputTax', label: 'Vorsteuerbeträge aus Rechnungen von anderen Unternehmern (§ 15 Absatz 1 Satz 1 Nummer 1 UStG)', unit: 'cents', source: 'inputTax', taxation: 'regular' },
  { code: '61', group: 'inputTax', label: 'Vorsteuerbeträge aus dem innergemeinschaftlichen Erwerb von Gegenständen (§ 15 Absatz 1 Satz 1 Nummer 3 UStG)', unit: 'cents', source: 'inputTaxAcquisition', taxation: 'regular' },
  { code: '67', group: 'inputTax', label: 'Vorsteuerbeträge aus Leistungen im Sinne des § 13b UStG (§ 15 Absatz 1 Satz 1 Nummer 4 UStG)', unit: 'cents', source: 'inputTaxReverseCharge', taxation: 'regular' },
  { code: '83', group: 'result', label: 'Verbleibende Umsatzsteuer-Vorauszahlung bzw. verbleibender Überschuss', unit: 'cents', source: 'result' },
];
const ADVANCE_NOTES = [NOTE_ONLY_WITH_VALUE];
const ADVANCE_TAXATION_NOTES = { smallBusiness: 'Kein Vorsteuerabzug als Kleinunternehmer.' } as const;

/** 2025 und 2026 gleich in allen Kennzahlen, die Kompass füllt (Fundstellen oben). */
const ADVANCE_2025: VatForm = { kind: 'advance', validFromYear: 2025, figures: ADVANCE_FIGURES, notes: ADVANCE_NOTES, taxationNotes: ADVANCE_TAXATION_NOTES };
const ADVANCE_2026: VatForm = { kind: 'advance', validFromYear: 2026, figures: ADVANCE_FIGURES, notes: ADVANCE_NOTES, taxationNotes: ADVANCE_TAXATION_NOTES };

const ANNUAL_2025_FIGURES: readonly VatFigure[] = [
  { code: '177', group: 'ownSupplies', label: 'Lieferungen und sonstige Leistungen zu 19 %, Bemessungsgrundlage', unit: 'euro', source: 'ownStandardBase', taxation: 'regular' },
  { code: '275', group: 'ownSupplies', label: 'Lieferungen und sonstige Leistungen zu 7 %, Bemessungsgrundlage', unit: 'euro', source: 'ownReducedBase', taxation: 'regular' },
  { code: '287', group: 'ownSupplies', label: 'Steuerfreie Umsätze ohne Vorsteuerabzug, nicht zum Gesamtumsatz gehörend', unit: 'euro', source: 'exemptNotCountedTurnover', taxation: 'regular' },
  { code: '236', group: 'ownSupplies', label: 'Steuerfreie Umsätze ohne Vorsteuerabzug nach § 19 Absatz 1 UStG', unit: 'euro', source: 'smallBusinessTurnover', taxation: 'smallBusiness' },
  { code: '240', group: 'ownSupplies', label: 'Steuerfreie Umsätze ohne Vorsteuerabzug, zum Gesamtumsatz gehörend', unit: 'euro', source: 'exemptCountedTurnover', taxation: 'regular' },
  { code: '781', group: 'acquisition', label: 'Steuerpflichtige innergemeinschaftliche Erwerbe zum Steuersatz von 19 %, Bemessungsgrundlage', unit: 'euro', source: 'acquisitionStandardBase' },
  { code: '793', group: 'acquisition', label: 'Steuerpflichtige innergemeinschaftliche Erwerbe zum Steuersatz von 7 %, Bemessungsgrundlage', unit: 'euro', source: 'acquisitionReducedBase' },
  { code: '846', group: 'reverseCharge', label: `${RC_EU}, Bemessungsgrundlage`, unit: 'euro', source: 'rc13bEuBase' },
  { code: '847', group: 'reverseCharge', label: 'Steuer dazu', unit: 'cents', source: 'rc13bEuTax' },
  { code: '877', group: 'reverseCharge', label: `${RC_OTHER}, Bemessungsgrundlage`, unit: 'euro', source: 'rc13bOtherBase' },
  { code: '878', group: 'reverseCharge', label: 'Steuer dazu', unit: 'cents', source: 'rc13bOtherTax' },
  { code: '320', group: 'inputTax', label: 'Vorsteuerbeträge aus Rechnungen von anderen Unternehmern (§ 15 Absatz 1 Satz 1 Nummer 1 UStG)', unit: 'cents', source: 'inputTax', taxation: 'regular' },
  { code: '761', group: 'inputTax', label: 'Vorsteuerbeträge aus innergemeinschaftlichen Erwerben von Gegenständen (§ 15 Absatz 1 Satz 1 Nummer 3 UStG)', unit: 'cents', source: 'inputTaxAcquisition', taxation: 'regular' },
  { code: '467', group: 'inputTax', label: 'Vorsteuerbeträge aus Leistungen im Sinne des § 13b UStG (§ 15 Absatz 1 Satz 1 Nummer 4 UStG)', unit: 'cents', source: 'inputTaxReverseCharge', taxation: 'regular' },
  { code: '816', group: 'result', label: 'Verbleibende Umsatzsteuer bzw. verbleibender Überschuss', unit: 'cents', source: 'result' },
];

export const VAT_FORMS: readonly VatForm[] = [
  ADVANCE_2025,
  ADVANCE_2026,
  { kind: 'annual', validFromYear: 2025, figures: ANNUAL_2025_FIGURES, notes: [NOTE_ONLY_WITH_VALUE] },
  {
    kind: 'annual',
    validFromYear: 2026,
    figures: ANNUAL_2025_FIGURES,
    notes: [NOTE_ONLY_WITH_VALUE],
  },
];

/** Die jüngste Fassung mit `validFromYear ≤ year`, sonst `null` (Kompass führt keine Voranmeldungen vor 2025 und keine Jahreserklärungen vor 2025). */
export function vatFormFor(kind: VatFormKind, year: number): VatForm | null {
  const candidates = VAT_FORMS.filter((f) => f.kind === kind && f.validFromYear <= year);
  return candidates.reduce<VatForm | null>((best, f) => (best === null || f.validFromYear > best.validFromYear ? f : best), null);
}

export { euroBase };
