import type { GemAnswers } from '../ledger/tax-periods';

/**
 * Rechenschaft D2 (Spec § D2 „Zuordnungstabelle“): welche Zeile der Anlage Gem woraus gefüllt wird — als Code, nicht als
 * Einstellung, weil den Vordruck der Gesetzgeber ändert, nicht der Verein. Gesucht wird nach dem Veranlagungsjahr, das
 * ist das Kalenderjahr des Endes des letzten Geschäftsjahres im Erklärungszeitraum.
 *
 * Rein (läuft auch im Browser, `@kompass/module-finance/gem-forms`): Zeilennummern, Wortlaut, Grenze, Bedingungen. Der
 * Wortlaut ist Text des Vordrucks, deutsch für Papier und Oberfläche (Prinzip 7); er geht nie in die gehashten Daten
 * eines Berichts — eine Änderung hier ändert den Hash nur, wenn Zeilennummern oder Quellen wechseln.
 */

export type GemSection = 'general' | 'revenue' | 'economic' | 'charitable' | 'welfare' | 'hospital' | 'sport' | 'reserves' | 'assets' | 'gifts' | 'other';
export type GemLineKind = 'yearRange' | 'amountPerYear' | 'amount' | 'yesNo' | 'date' | 'choice' | 'text' | 'list' | 'elster';
export type GemSource =
  | 'period'
  | 'revenue'
  | 'economicRevenue'
  | 'businessList'
  | 'purposeOperationList'
  | 'purposeOperationSum'
  | 'reservesProjectFunds'
  | 'reservesReplacement'
  | 'reserveFree'
  | 'reservesParticipation'
  | 'addsToAssets'
  | 'endowmentsGivenAny'
  | 'endowmentsGiven'
  | 'endowmentsReceivedAny'
  | 'endowmentsReceived'
  | 'noticePurposes'
  | { answer: keyof GemAnswers };

export interface GemLine {
  line: string;
  section: GemSection;
  label: string;
  kind: GemLineKind;
  source: GemSource;
  /** Die Zeile gibt es nur, wenn die genannte Ja/Nein-Zeile diesen Wert hat (sonst fehlt sie im Bericht ganz). */
  showWhen?: { line: string; equals: boolean };
  /** Eine Angabe von Ihnen, ohne die die Fassung nicht festgeschrieben werden kann. */
  required?: boolean;
  /** Pflicht nur, wenn diese Angabe ein Datum trägt (Zeile 8 zum Beitragsbeschluss in Zeile 7). */
  requiredWith?: keyof GemAnswers;
  /** Spalten einer Liste, als Schlüssel der Listenzeilen. */
  columns?: readonly string[];
  /** Zeilennummer nach Ausfüllhilfe 2025, nicht an Mein ELSTER geprüft (Zeilen 50–70). */
  unverified?: true;
  help?: string;
}

export interface GemForm {
  validFromYear: number;
  /** Grenze in Zeile 10 laut Vordruck (Einnahmen aller wGB einschließlich Zweckbetriebe, „mehr als“). */
  line10LimitCents: number;
  lines: readonly GemLine[];
  notes: readonly string[];
  /** Der Vordruck ist noch nicht erschienen; Kompass nimmt den Aufbau der Vorfassung an. */
  assumed?: true;
}

export const GEM_UNVERIFIED_NOTE = 'Zeilennummern nach Ausfüllhilfe 2025, nicht an Mein ELSTER geprüft';

/** Teilseiten 1–10 der Anlage Gem in Mein ELSTER (E23, E25), dazu „Weitere Angaben“. */
export const GEM_SECTION_TITLES: Record<GemSection, string> = {
  general: 'Allgemeine Angaben',
  revenue: 'Gesamteinnahmen',
  economic: 'Wirtschaftliche Betätigung',
  charitable: 'Mildtätige Zwecke',
  welfare: 'Wohlfahrtspflege',
  hospital: 'Krankenhaus',
  sport: 'Sport',
  reserves: 'Rücklagen',
  assets: 'Zuführung von Vermögen, Ausstattung anderer Körperschaften',
  gifts: 'Unentgeltliche Zuwendungen',
  other: 'Weitere Angaben',
};

const IN_ELSTER = 'Trifft das zu, tragen Sie die Angaben dieses Blocks in ELSTER ein; Kompass hat dafür keine Daten.';

function linesOf(opts: { line10Limit: string; charitableLines: string }): readonly GemLine[] {
  return [
    { line: '1', section: 'general', label: 'Prüfungszeitraum', kind: 'yearRange', source: 'period' },
    { line: '2', section: 'general', label: 'Die Körperschaft verfolgt kirchliche Zwecke', kind: 'yesNo', source: { answer: 'churchPurposes' }, required: true },
    { line: '3', section: 'general', label: 'Die Körperschaft verfolgt mildtätige Zwecke', kind: 'yesNo', source: { answer: 'charitablePurposes' }, required: true },
    { line: '4', section: 'general', label: 'Die Körperschaft verfolgt folgende gemeinnützige Zwecke', kind: 'text', source: 'noticePurposes', help: 'Die Nummern nach § 52 Abs. 2 AO wählen Sie in ELSTER.' },
    { line: '5', section: 'general', label: 'Datum der zurzeit gültigen Satzung', kind: 'date', source: { answer: 'statuteDate' }, required: true },
    { line: '6', section: 'general', label: 'Die Satzung liegt dem Finanzamt vor bzw. wird gesondert übermittelt', kind: 'choice', source: { answer: 'statuteSubmission' }, required: true },
    { line: '7', section: 'general', label: 'Datum des Beschlusses über Mitgliedsbeiträge, Umlagen und Aufnahmegebühren', kind: 'date', source: { answer: 'feeResolution' }, required: true },
    { line: '8', section: 'general', label: 'Der Beschluss liegt dem Finanzamt vor bzw. wird gesondert übermittelt', kind: 'choice', source: { answer: 'feeResolutionSubmission' }, requiredWith: 'feeResolution' },
    {
      line: '9',
      section: 'revenue',
      label: 'Gesamteinnahmen (einschließlich Beiträge, Spenden, Zuschüsse, Einnahmen aus der Vermögensverwaltung und aus wirtschaftlichen Betätigungen, Umsatzsteuer)',
      kind: 'amountPerYear',
      source: 'revenue',
    },
    { line: '10', section: 'economic', label: `Die Einnahmen des letzten Jahres (einschließlich Umsatzsteuer) aus wirtschaftlichen Geschäftsbetrieben einschließlich Zweckbetriebe betragen mehr als ${opts.line10Limit}`, kind: 'yesNo', source: 'economicRevenue' },
    { line: '11', section: 'economic', label: 'Steuerpflichtige wirtschaftliche Geschäftsbetriebe: Bezeichnung, Einnahmen (mit Umsatzsteuer), Ausgaben, Überschuss oder Fehlbetrag', kind: 'list', source: 'businessList', showWhen: { line: '10', equals: true }, columns: ['designation', 'incomeCents', 'expenseCents', 'resultCents'] },
    { line: '18', section: 'economic', label: 'Zweckbetriebe: Bezeichnung, Einnahmen (mit Umsatzsteuer)', kind: 'list', source: 'purposeOperationList', showWhen: { line: '10', equals: true }, columns: ['designation', 'incomeCents'] },
    { line: '24', section: 'economic', label: 'Summe der Einnahmen aus allen Zweckbetrieben', kind: 'amount', source: 'purposeOperationSum', showWhen: { line: '10', equals: true } },
    { line: '25', section: 'charitable', label: `Mildtätige Zwecke (Zeilen ${opts.charitableLines})`, kind: 'elster', source: { answer: 'charitablePurposes' }, showWhen: { line: '3', equals: true }, help: IN_ELSTER },
    { line: '30', section: 'welfare', label: 'Die Körperschaft ist eine Einrichtung der Wohlfahrtspflege (§ 66 AO, Zeilen 30–37)', kind: 'yesNo', source: { answer: 'welfare' }, required: true, help: IN_ELSTER },
    { line: '38', section: 'hospital', label: 'Die Körperschaft betreibt ein Krankenhaus (§ 67 AO)', kind: 'yesNo', source: { answer: 'hospital' }, required: true, help: IN_ELSTER },
    { line: '39', section: 'sport', label: 'Die Körperschaft hat sportliche Veranstaltungen durchgeführt (§ 67a AO, Zeilen 39–49)', kind: 'yesNo', source: { answer: 'sport' }, required: true, help: IN_ELSTER },
    { line: '50', section: 'reserves', label: 'Am Ende des letzten Jahres bestanden: Rücklage nach § 62 Abs. 1 Nr. 1 AO für folgende Vorhaben', kind: 'list', source: 'reservesProjectFunds', columns: ['designation', 'amountCents'], unverified: true },
    {
      line: '54',
      section: 'reserves',
      label: 'Rücklage nach § 62 Abs. 1 Nr. 2 AO (Wiederbeschaffung, Zeilen 54–54e): Wirtschaftsgut, voraussichtliche Anschaffungskosten, reguläre AfA, Zuführung, Auflösung, kumulierte Rücklage',
      kind: 'list',
      source: 'reservesReplacement',
      columns: ['asset', 'expectedCostCents', 'regularDepreciationCents', 'allocatedCents', 'dissolvedCents', 'balanceCents'],
      unverified: true,
    },
    { line: '58', section: 'reserves', label: 'Freie Rücklage nach § 62 Abs. 1 Nr. 3 AO', kind: 'amount', source: 'reserveFree', unverified: true },
    { line: '59', section: 'reserves', label: 'Rücklage nach § 62 Abs. 1 Nr. 4 AO (Erhaltung der Beteiligungsquote): Kapitalgesellschaft, Finanzamt, Steuernummer, Betrag', kind: 'list', source: 'reservesParticipation', columns: ['company', 'taxOffice', 'taxNumber', 'amountCents'], unverified: true },
    { line: '63', section: 'assets', label: 'Zuführungen zum Vermögen nach § 62 Abs. 3 Nr. 1 bis 4 und Abs. 4 AO (ggf. 0)', kind: 'amount', source: 'addsToAssets', unverified: true },
    { line: '64', section: 'assets', label: 'Mittel zur Vermögensausstattung an eine steuerbegünstigte Körperschaft oder juristische Person des öffentlichen Rechts zugewendet (§ 58 Nr. 3 AO)', kind: 'yesNo', source: 'endowmentsGivenAny', unverified: true },
    { line: '65', section: 'assets', label: 'Empfängerkörperschaft, Finanzamt, Steuernummer, begünstigter Zweck, Betrag', kind: 'list', source: 'endowmentsGiven', showWhen: { line: '64', equals: true }, columns: ['party', 'taxOffice', 'taxNumber', 'purpose', 'amountCents'], unverified: true },
    { line: '69', section: 'assets', label: 'Mittel zur Vermögensausstattung von einer steuerbegünstigten Körperschaft erhalten (§ 58 Nr. 3 AO)', kind: 'yesNo', source: 'endowmentsReceivedAny', unverified: true },
    { line: '70', section: 'assets', label: 'Geberkörperschaft, Finanzamt, Steuernummer, begünstigter Zweck, Betrag', kind: 'list', source: 'endowmentsReceived', showWhen: { line: '69', equals: true }, columns: ['party', 'taxOffice', 'taxNumber', 'purpose', 'amountCents'], unverified: true },
    { line: '74', section: 'gifts', label: 'Mitglieder, Gesellschafter oder außenstehende Personen haben unentgeltliche Zuwendungen erhalten, die nicht der Erfüllung des Satzungszwecks dienten', kind: 'yesNo', source: { answer: 'gratuitousBenefits' }, required: true },
    { line: '75', section: 'gifts', label: 'Zuwendungsgrund, Betrag', kind: 'list', source: { answer: 'gratuitousBenefitList' }, showWhen: { line: '74', equals: true }, required: true, columns: ['reason', 'amountCents'] },
    { line: '79', section: 'other', label: 'Vergütungen an beschränkt Steuerpflichtige, für die ein Steuerabzug nach § 50a EStG vorzunehmen ist', kind: 'yesNo', source: { answer: 'withholdingTax50a' }, help: 'Ob es die Zeile ab 2025 noch gibt, ist unsicher; sonst gehört die Angabe in die Anlage WA.' },
  ];
}

/**
 * Die Fassungen, älteste zuerst. Quellen (Recherche 2026-10-24, Nachtrag „Abgleich mit dem Originalvordruck“, cb6c24e):
 * P17 (Papiervordruck 2017), E23 (Thüringen, Bildschirmfotos 2023), E25 (OFD NRW, Bildschirmfotos 2025), H25 (Anleitung
 * zur KSt 2025), S25 (Stotax 2025). Die Teilseiten 8 und 9 (Zeilen 50–70) folgen den Ausfüllhilfen 2025 und sind nicht an
 * Mein ELSTER geprüft (`unverified`); Joe gleicht sie ab, sobald der Verein ELSTER hat (Joe 2026-10-25) — eine Abweichung
 * ändert nur diese Datei. Grenze in Zeile 10: 45.000 € bis Fassung 2025, 50.000 € ab 2026 (§ 64 Abs. 3 AO n. F.;
 * Einnahmenbegriff nach AEAO zu § 64 Nr. 18–20, Fassung AO-Handbuch 2025, früher Nr. 15–17).
 */
export const GEM_FORMS: readonly GemForm[] = [
  { validFromYear: 2023, line10LimitCents: 4_500_000, lines: linesOf({ line10Limit: '45.000 €', charitableLines: '25–27' }), notes: [GEM_UNVERIFIED_NOTE] },
  { validFromYear: 2025, line10LimitCents: 4_500_000, lines: linesOf({ line10Limit: '45.000 €', charitableLines: '25–28' }), notes: [GEM_UNVERIFIED_NOTE] },
  { validFromYear: 2026, line10LimitCents: 5_000_000, lines: linesOf({ line10Limit: '50.000 €', charitableLines: '25–28' }), notes: [GEM_UNVERIFIED_NOTE, 'Vordruck 2026 noch nicht erschienen; Aufbau wie 2025 angenommen'], assumed: true },
];

/** Die jüngste Fassung mit `validFromYear` ≤ Jahr; vor 2023 keine (es gibt seit 2023 nur das ELSTER-Formular). */
export function gemFormFor(assessmentYear: number): GemForm | null {
  return [...GEM_FORMS].reverse().find((f) => f.validFromYear <= assessmentYear) ?? null;
}

/** Das Veranlagungsjahr: das Kalenderjahr des Endes (WJ 01.07.2025–30.06.2026 → 2026). */
export function assessmentYearOf(endsOn: string): number {
  return Number(endsOn.slice(0, 4));
}
