/**
 * Der amtliche Wortlaut der Zuwendungsbestätigungen — die eine Stelle dafür.
 *
 * WORTLAUT AUS DEM GEDÄCHTNIS; VOR DER ERSTEN ECHTEN BESTÄTIGUNG GEGEN DAS
 * BMF-MUSTER PRÜFEN (Befundliste § 1).
 *
 * Quelle: BMF-Schreiben vom 7. November 2013, IV C 4 – S 2223/07/0018 :005,
 * Muster für Zuwendungsbestätigungen an eine der in § 5 Abs. 1 Nr. 9 KStG
 * bezeichneten Körperschaften, Personenvereinigungen oder Vermögensmassen:
 * „Bestätigung über Geldzuwendungen/Mitgliedsbeitrag“, „Bestätigung über
 * Sachzuwendungen“, „Sammelbestätigung über Geldzuwendungen/Mitgliedsbeiträge“
 * mit Anlage. Deutsch, weil amtlich vorgeschrieben — Ausnahme von Prinzip 7
 * (`AGENTS.md`). Der Hinweis zum maschinellen Verfahren stammt nicht aus dem
 * Muster, sondern folgt R 10b.1 Abs. 4 EStR.
 *
 * Rein: kein Import. Werte (Finanzamt, Datum, Zwecke) setzen die Funktionen
 * ein; Datumsangaben kommen schon im deutschen Format (TT.MM.JJJJ).
 */

// ── Kopf ────────────────────────────────────────────────────────────────────

export const ISSUER_LABEL = 'Aussteller (Bezeichnung und Anschrift der steuerbegünstigten Einrichtung)';
export const TITLE_MONEY = 'Bestätigung über Geldzuwendungen/Mitgliedsbeitrag';
export const TITLE_IN_KIND = 'Bestätigung über Sachzuwendungen';
export const TITLE_COLLECTIVE = 'Sammelbestätigung über Geldzuwendungen/Mitgliedsbeiträge';
export const SUBTITLE =
  'im Sinne des § 10b des Einkommensteuergesetzes an eine der in § 5 Abs. 1 Nr. 9 des Körperschaftsteuergesetzes bezeichneten Körperschaften, Personenvereinigungen oder Vermögensmassen';
export const DONOR_LABEL = 'Name und Anschrift des Zuwendenden:';

// ── Betrag und Tag ──────────────────────────────────────────────────────────

export const MONEY_AMOUNT_LABEL = 'Betrag der Zuwendung';
export const IN_KIND_AMOUNT_LABEL = 'Wert der Zuwendung';
export const COLLECTIVE_AMOUNT_LABEL = 'Gesamtbetrag der Zuwendung';
export const IN_FIGURES = '- in Ziffern -';
export const IN_WORDS = '- in Buchstaben -';
export const DATE_LABEL = 'Tag der Zuwendung:';
export const PERIOD_LABEL = 'Zeitraum der Sammelbestätigung:';
/** Zeitraum als Wert, Daten im Format TT.MM.JJJJ. */
export function periodText(from: string, to: string): string {
  return `${from} bis ${to}`;
}

// ── Verzicht auf Erstattung von Aufwendungen ────────────────────────────────

export const WAIVER_SENTENCE = 'Es handelt sich um den Verzicht auf Erstattung von Aufwendungen';
export const YES = 'Ja';
export const NO = 'Nein';

// ── Bescheid-Sätze je Art ───────────────────────────────────────────────────

export interface NoticeWording {
  kind: 'section60a' | 'exemptionNotice' | 'corporateTaxNoticeAttachment';
  taxOffice: string;
  taxNumber: string;
  /** TT.MM.JJJJ */
  noticeDate: string;
  /** „2023“ oder „2021–2023“; bei § 60a leer. */
  assessmentPeriod: string | null;
  /** Die begünstigten Zwecke im Wortlaut des Bescheids. */
  purposesText: string;
}

/**
 * Freistellungsbescheid und Anlage zum Körperschaftsteuerbescheid teilen im
 * Muster einen Satz („nach dem Freistellungsbescheid bzw. nach der Anlage zum
 * Körperschaftsteuerbescheid“); gedruckt wird nur die zutreffende Hälfte.
 */
export function noticeSentence(n: NoticeWording): string {
  if (n.kind === 'section60a') {
    return (
      `Die Einhaltung der satzungsmäßigen Voraussetzungen nach den §§ 51, 59, 60 und 61 AO wurde vom Finanzamt ${n.taxOffice}, ` +
      `StNr. ${n.taxNumber}, mit Bescheid vom ${n.noticeDate} nach § 60a AO gesondert festgestellt. ` +
      `Wir fördern nach unserer Satzung ${n.purposesText}.`
    );
  }
  const source = n.kind === 'exemptionNotice' ? 'nach dem Freistellungsbescheid' : 'nach der Anlage zum Körperschaftsteuerbescheid';
  return (
    `Wir sind wegen Förderung ${n.purposesText} ${source} des Finanzamtes ${n.taxOffice}, StNr. ${n.taxNumber}, vom ${n.noticeDate} ` +
    `für den letzten Veranlagungszeitraum ${n.assessmentPeriod ?? ''} nach § 5 Abs. 1 Nr. 9 des Körperschaftsteuergesetzes ` +
    `von der Körperschaftsteuer und nach § 3 Nr. 6 des Gewerbesteuergesetzes von der Gewerbesteuer befreit.`
  );
}

/** Verwendungs-Satz. */
export function usageSentence(purposesText: string): string {
  return `Es wird bestätigt, dass die Zuwendung nur zur Förderung ${purposesText} verwendet wird.`;
}

// ── Mitgliedsbeitrag ────────────────────────────────────────────────────────

/** Überschrift vor dem Satz — gedruckt nur, wenn Mitgliedsbeiträge nicht abziehbar sind. */
export const MEMBERSHIP_HEADING = 'Nur für steuerbegünstigte Einrichtungen, bei denen die Mitgliedsbeiträge steuerlich nicht abziehbar sind:';
export const MEMBERSHIP_SENTENCE =
  'Es wird bestätigt, dass es sich nicht um einen Mitgliedsbeitrag handelt, dessen Abzug nach § 10b Abs. 1 des Einkommensteuergesetzes ausgeschlossen ist.';
export const MEMBERSHIP_SENTENCE_COLLECTIVE =
  'Es wird bestätigt, dass es sich nicht um Mitgliedsbeiträge handelt, deren Abzug nach § 10b Abs. 1 des Einkommensteuergesetzes ausgeschlossen ist.';

// ── Sachzuwendung ───────────────────────────────────────────────────────────

export const IN_KIND_ITEM_LABEL = 'Genaue Bezeichnung der Sachzuwendung mit Alter, Zustand, Kaufpreis usw.';
export const IN_KIND_ORIGIN_BUSINESS =
  'Die Sachzuwendung stammt nach den Angaben des Zuwendenden aus dem Betriebsvermögen. Die Zuwendung wurde nach dem Wert der Entnahme (ggf. mit dem niedrigeren gemeinen Wert) und nach der Umsatzsteuer, die auf die Entnahme entfällt, bewertet.';
export const IN_KIND_ORIGIN_PRIVATE = 'Die Sachzuwendung stammt nach den Angaben des Zuwendenden aus dem Privatvermögen.';
export const IN_KIND_VALUATION_DOCUMENTS = 'Geeignete Unterlagen, die zur Wertermittlung gedient haben, z. B. Rechnung, Gutachten, liegen vor.';
/** Kein Mustertext: die Werte, die der Betriebsvermögen-Satz nennt, ausgewiesen. Beträge schon formatiert. */
export function inKindWithdrawal(withdrawalValue: string, vat: string): string {
  return `Wert der Entnahme: ${withdrawalValue}; darauf entfallende Umsatzsteuer: ${vat}.`;
}

// ── Sammelbestätigung ───────────────────────────────────────────────────────

export const COLLECTIVE_NO_OTHER_CONFIRMATIONS =
  'Es wird bestätigt, dass über die in der Gesamtsumme enthaltenen Zuwendungen keine weiteren Bestätigungen, weder formelle Zuwendungsbestätigungen noch Beitragsquittungen oder Ähnliches ausgestellt wurden und werden.';
export const COLLECTIVE_WAIVER_REFERENCE = 'Ob es sich um den Verzicht auf Erstattung von Aufwendungen handelt, ist der Anlage zur Sammelbestätigung zu entnehmen.';
export const ATTACHMENT_TITLE = 'Anlage zur Sammelbestätigung';
export const ATTACHMENT_COLUMN_DATE = 'Datum der Zuwendung';
export const ATTACHMENT_COLUMN_KIND = 'Art der Zuwendung (Geldzuwendung/Mitgliedsbeitrag)';
export const ATTACHMENT_COLUMN_WAIVER = 'Verzicht auf die Erstattung von Aufwendungen (ja/nein)';
export const ATTACHMENT_COLUMN_AMOUNT = 'Betrag';
export const ATTACHMENT_KIND_DONATION = 'Geldzuwendung';
export const ATTACHMENT_KIND_MEMBERSHIP_FEE = 'Mitgliedsbeitrag';
export const ATTACHMENT_YES = 'ja';
export const ATTACHMENT_NO = 'nein';
export const ATTACHMENT_TOTAL = 'Gesamtsumme';

// ── Unterschrift und Hinweise ───────────────────────────────────────────────

export const SIGNATURE_CAPTION = '(Ort, Datum und Unterschrift des Zuwendungsempfängers)';
export const NOTE_HEADING = 'Hinweis:';
export const LIABILITY_NOTE =
  'Wer vorsätzlich oder grob fahrlässig eine unrichtige Zuwendungsbestätigung erstellt oder veranlasst, dass Zuwendungen nicht zu den in der Zuwendungsbestätigung angegebenen steuerbegünstigten Zwecken verwendet werden, haftet für die entgangene Steuer (§ 10b Abs. 4 EStG, § 9 Abs. 3 KStG, § 9 Nr. 5 GewStG).';
export const VALIDITY_NOTE =
  'Diese Bestätigung wird nicht als Nachweis für die steuerliche Berücksichtigung der Zuwendung anerkannt, wenn das Datum des Freistellungsbescheides länger als 5 Jahre bzw. das Datum der Feststellung der Einhaltung der satzungsmäßigen Voraussetzungen nach § 60a Abs. 1 AO länger als 3 Jahre seit Ausstellung der Bestätigung zurückliegt (§ 63 Abs. 5 AO).';

/** Maschinelles Verfahren (R 10b.1 Abs. 4 EStR): nur, wenn es vollständig eingerichtet und angezeigt ist. `notifiedOn` im Format TT.MM.JJJJ. */
export function machineNote(taxOffice: string, notifiedOn: string): string {
  return `Diese Zuwendungsbestätigung wurde maschinell erstellt und ist ohne eigenhändige Unterschrift gültig. Die Anwendung des maschinellen Verfahrens wurde dem Finanzamt ${taxOffice} am ${notifiedOn} angezeigt.`;
}
