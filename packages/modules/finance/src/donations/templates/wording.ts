/**
 * Der amtliche Wortlaut der Zuwendungsbestätigungen — die eine Stelle dafür.
 *
 * Geprüft am 2026-09-25 gegen die Muster Anlagen 3, 4 und 14 (EStH 2020,
 * Anlage 3 auch EStH 2023) und § 50 Abs. 4 EStDV; siehe
 * `docs/intern/recherche/2026-09-25-steuerfragen-quellen.md` § 8.
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
/** Auch die Sammelbestätigung druckt den Singular (Anlage 14 EStH 2020). */
export const MEMBERSHIP_SENTENCE =
  'Es wird bestätigt, dass es sich nicht um einen Mitgliedsbeitrag handelt, dessen Abzug nach § 10b Abs. 1 des Einkommensteuergesetzes ausgeschlossen ist.';

// ── Sachzuwendung ───────────────────────────────────────────────────────────

export const IN_KIND_ITEM_LABEL = 'Genaue Bezeichnung der Sachzuwendung mit Alter, Zustand, Kaufpreis usw.';
export const IN_KIND_ORIGIN_BUSINESS =
  'Die Sachzuwendung stammt nach den Angaben des Zuwendenden aus dem Betriebsvermögen. Die Zuwendung wurde nach dem Wert der Entnahme (ggf. mit dem niedrigeren gemeinen Wert) und nach der Umsatzsteuer, die auf die Entnahme entfällt, bewertet.';
/**
 * Das Muster (Anlage 4) kennt einen dritten Herkunftssatz: „Der Zuwendende hat
 * trotz Aufforderung keine Angaben zur Herkunft der Sachzuwendung gemacht.“
 * `origin` kennt nur privat und betrieblich; der Satz wird deshalb nie gedruckt.
 */
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
/**
 * Fassung der Muster (Anlagen 3, 4, 12, 13, 14 EStH 2020, Anlage 3 EStH 2023):
 * „seit Ausstellung des Bescheides“. „der Bestätigung“ war die Übergangsfassung
 * aus BMF 2013 Nr. 13.
 */
export const VALIDITY_NOTE =
  'Diese Bestätigung wird nicht als Nachweis für die steuerliche Berücksichtigung der Zuwendung anerkannt, wenn das Datum des Freistellungsbescheides länger als 5 Jahre bzw. das Datum der Feststellung der Einhaltung der satzungsmäßigen Voraussetzungen nach § 60a Abs. 1 AO länger als 3 Jahre seit Ausstellung des Bescheides zurückliegt (§ 63 Abs. 5 AO).';

/** Maschinelles Verfahren (R 10b.1 Abs. 4 EStR): nur, wenn es vollständig eingerichtet und angezeigt ist. `notifiedOn` im Format TT.MM.JJJJ. */
export function machineNote(taxOffice: string, notifiedOn: string): string {
  return `Diese Zuwendungsbestätigung wurde maschinell erstellt und ist ohne eigenhändige Unterschrift gültig. Die Anwendung des maschinellen Verfahrens wurde dem Finanzamt ${taxOffice} am ${notifiedOn} angezeigt.`;
}

// ── Anzeige des maschinellen Verfahrens ─────────────────────────────────────

/** Wem die Anzeige gilt und von wem sie kommt — ohne sie spricht der Brief vom „Verein“ und lässt die Kopfzeilen weg. */
export interface NotificationLetterContext {
  organizationName: string;
  taxOffice: string;
  taxNumber: string;
}

/**
 * KEIN MUSTERTEXT. Es gibt kein amtliches Muster für die Anzeige; dieser Brief
 * ist ein Vorschlag des Moduls, den der Verein im Entwurf der Akte vor dem
 * Festschreiben liest und anpasst. Er folgt R 10b.1 Abs. 4 EStR: Die
 * Anwendung des maschinellen Verfahrens ist dem Finanzamt anzuzeigen; die
 * Bestätigungen entsprechen dem amtlichen Muster, tragen den Hinweis auf die
 * Anzeige, eine Unterschrift erscheint als Faksimile, das Verfahren ist gegen
 * unbefugte Eingriffe gesichert, Buchung und Bestätigung hängen zusammen, und
 * das Verfahren ist prüfbar.
 *
 * Markdown, wie der Text eines Briefentwurfs (`docs/handbuch/akte/brief-schreiben.md`).
 * `notifiedOn` im Format TT.MM.JJJJ: Ist die Anzeige schon vermerkt, nennt
 * der Brief ihr Datum (etwa bei einem neuen Unterzeichner).
 */
export function notificationLetter(signerName: string, notifiedOn?: string | null, context?: NotificationLetterContext): string {
  const verein = context ? context.organizationName : 'unser Verein';
  const head = context ? [`${context.taxOffice}  \nSteuernummer ${context.taxNumber}`, ''] : [];
  const earlier = notifiedOn ? [`Die Anwendung des Verfahrens haben wir Ihnen bereits am ${notifiedOn} angezeigt; dieses Schreiben nennt den aktuellen Stand.`, ''] : [];
  return [
    ...head,
    'Sehr geehrte Damen und Herren,',
    '',
    `hiermit zeigen wir Ihnen nach R 10b.1 Abs. 4 EStR an, dass ${verein} Zuwendungsbestätigungen über Geldzuwendungen, Mitgliedsbeiträge und Sachzuwendungen maschinell erstellt.`,
    '',
    ...earlier,
    'Zum Verfahren:',
    '',
    '- Die Bestätigungen entsprechen dem amtlichen Muster und tragen den Hinweis, dass sie maschinell erstellt wurden und die Anwendung des Verfahrens dem Finanzamt angezeigt wurde.',
    `- Statt einer eigenhändigen Unterschrift wird beim Erstellen das Faksimile der Unterschrift von ${signerName} eingedruckt, der oder die für den Verein zeichnungsberechtigt ist.`,
    '- Das Verfahren ist gegen unbefugte Eingriffe gesichert: Bestätigungen stellen nur berechtigte Personen aus, jede Ausstellung steht im Änderungsprotokoll, und das Faksimile ist nur ihnen zugänglich.',
    '- Die Bestätigungen entstehen aus den festgeschriebenen Buchungen der Finanzbuchhaltung; Buchung und Bestätigung sind miteinander verbunden, die Summen lassen sich abstimmen.',
    '- Aufbau und Ablauf des Verfahrens sind dokumentiert und für Sie innerhalb angemessener Zeit prüfbar.',
    '',
    'Für Rückfragen stehen wir Ihnen gern zur Verfügung.',
    '',
    'Mit freundlichen Grüßen',
    '',
    signerName,
  ].join('\n');
}

// ── Vereinfachter Zuwendungsnachweis (§ 50 Abs. 4 EStDV) ────────────────────

/**
 * KEIN MUSTERTEXT. Für den vereinfachten Nachweis gibt es kein amtliches
 * Muster; § 50 Abs. 4 Satz 1 Nr. 2 Buchst. b EStDV verlangt nur, dass der
 * steuerbegünstigte Zweck, die Angaben über die Freistellung (Bescheid-Satz)
 * und die Angabe, ob es sich um eine Spende oder einen Mitgliedsbeitrag
 * handelt, auf einem vom Empfänger hergestellten Beleg aufgedruckt sind. Den
 * Rest dieses Vordrucks — Überschrift und Erläuterung — schlägt das Modul vor.
 * Geprüft am 2026-09-25 gegen § 50 Abs. 4 EStDV; siehe
 * `docs/intern/recherche/2026-09-25-steuerfragen-quellen.md` § 8.
 */
export const SIMPLIFIED_TITLE = 'Vereinfachter Zuwendungsnachweis';
export const SIMPLIFIED_DONATION_SENTENCE = 'Die Zuwendung ist eine Spende, kein Mitgliedsbeitrag.';
/** KEIN MUSTERTEXT. `limit` schon formatiert („300,00 €“). Die Elemente der Buchungsbestätigung nach § 50 Abs. 4 S. 2 EStDV. */
export function simplifiedReceiptSentence(limit: string): string {
  return (
    `Für Zuwendungen bis ${limit} genügt als Nachweis für das Finanzamt dieser Beleg zusammen mit dem Bareinzahlungsbeleg ` +
    `oder der Buchungsbestätigung eines Kreditinstituts, etwa dem Kontoauszug (§ 50 Abs. 4 EStDV). Die Buchungsbestätigung muss ` +
    `Name und Kontonummer oder ein sonstiges Identifizierungsmerkmal des Auftraggebers und des Empfängers, den Betrag, den Buchungstag sowie die tatsächliche Durchführung der Zahlung erkennen lassen.`
  );
}
