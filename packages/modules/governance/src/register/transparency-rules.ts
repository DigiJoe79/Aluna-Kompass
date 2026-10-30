import type { FilingRow, FilingTransparency, OccasionRow } from '../schema';

/**
 * Prüffragen zum Transparenzregister (Spec § 7.2, Rechtsprüfung K6) — Daten des Moduls, weil die AMLR ab 10.07.2027
 * die Regeln ändern kann. Jedes „ja“ löst eine Meldung aus; Frage 1 ist deshalb verneint gestellt („nicht
 * unverzüglich angemeldet?“), und „alle nein“ heißt „keine Meldung nötig“. Der Wortlaut steht unter `textKey`.
 * `computed`: Frage 1 beantwortet Kompass aus der Anmeldung selbst (Joe 2026-10-28), nie von Hand.
 */
export const TRANSPARENCY_QUESTIONS = [
  { key: 'notFiledPromptly', norm: '§ 20a Abs. 2 GwG', textKey: 'governance.transparency.questions.notFiledPromptly', computed: true },
  { key: 'foreignBoardMember', norm: '§ 20a Abs. 2 GwG', textKey: 'governance.transparency.questions.foreignBoardMember', computed: false },
  { key: 'earlierOwnReport', norm: '§ 20a Abs. 2 GwG', textKey: 'governance.transparency.questions.earlierOwnReport', computed: false },
  { key: 'controlOtherwise', norm: '§ 3 Abs. 2 GwG', textKey: 'governance.transparency.questions.controlOtherwise', computed: false },
] as const;
export type TransparencyKey = (typeof TRANSPARENCY_QUESTIONS)[number]['key'];
export const TRANSPARENCY_KEYS = TRANSPARENCY_QUESTIONS.map((q) => q.key) as [TransparencyKey, ...TransparencyKey[]];
/** Die Fragen, die ein Mensch am Vorgang beantwortet (2–4). */
export type ManualTransparencyKey = Extract<(typeof TRANSPARENCY_QUESTIONS)[number], { computed: false }>['key'];
export const TRANSPARENCY_MANUAL_KEYS = TRANSPARENCY_QUESTIONS.filter((q) => !q.computed).map((q) => q.key) as [ManualTransparencyKey, ...ManualTransparencyKey[]];

export type TransparencyCheck = { answers: Partial<Record<TransparencyKey, boolean>>; checkedOn: string | null; confirmationDocumentId: string | null; extractDocumentIds: string[] };
export type TransparencyResult = 'notApplicable' | 'open' | 'noReportNeeded' | 'reportNeeded';
/**
 * `promptlyBy`: bis zu diesem Tag gilt die Anmeldung als unverzüglich (Grenze für Frage 1); `null` ohne berührenden Anlass.
 * `due`: die Prüffragen zählen — erst ab der Einreichung (oder, nachgetragen, der Eintragung); davor keine Warnung und
 * keine Frist (Joe 2026-10-29, 0.5.0 Nr. 6).
 */
export type TransparencyView = TransparencyCheck & { result: TransparencyResult; promptlyBy: string | null; due: boolean };

/** Nur ein Vorstandswechsel, eine Änderung der Vertretung oder die Ersteintragung berühren das Transparenzregister. */
const APPLICABLE: readonly OccasionRow['kind'][] = ['initial', 'boardChange', 'representation'];
const EMPTY: TransparencyCheck = { answers: {}, checkedOn: null, confirmationDocumentId: null, extractDocumentIds: [] };

/** Der gespeicherte Stand nur mit den Fragen 2–4 — eine früher von Hand gespeicherte Antwort auf Frage 1 zählt nicht. */
export function transparencyCheckOf(stored: FilingTransparency | null): TransparencyCheck {
  if (!stored) return EMPTY;
  const answers = Object.fromEntries(TRANSPARENCY_MANUAL_KEYS.filter((k) => typeof stored.answers[k] === 'boolean').map((k) => [k, stored.answers[k]]));
  return { ...EMPTY, ...stored, answers };
}

/** Ergebnis der Prüffragen: ein „ja“ → Meldung nötig; alle vier „nein“ → keine Meldung nötig; sonst offen. */
export function transparencyResultInternal(check: TransparencyCheck, occasions: Pick<OccasionRow, 'kind'>[]): TransparencyResult {
  if (!occasions.some((o) => APPLICABLE.includes(o.kind))) return 'notApplicable';
  const answers = TRANSPARENCY_KEYS.map((k) => check.answers[k]);
  if (answers.some((a) => a === true)) return 'reportNeeded';
  return answers.every((a) => a === false) ? 'noReportNeeded' : 'open';
}

/**
 * Frage 1, berechnet (Spec § 7.1/§ 7.2, Joe 2026-10-28): eingereicht bis `dueOn` nach dem frühesten berührenden
 * Anlass → unverzüglich (`false`); eingereicht danach oder bis heute die Grenze überschritten, ohne eingereicht zu sein
 * → nicht unverzüglich (`true`); sonst offen. Eine eingetragene Anmeldung ohne Einreichungstag (nachgetragen) zählt
 * mit dem Tag der Eintragung.
 */
function notFiledPromptlyOf(filing: Pick<FilingRow, 'submittedOn' | 'registeredOn'>, limit: string | null, today: string): boolean | undefined {
  if (limit === null) return undefined;
  const submitted = filing.submittedOn ?? filing.registeredOn;
  if (submitted) return submitted > limit;
  return today > limit ? true : undefined;
}

/**
 * Ab wann die Prüffragen zählen (Joe 2026-10-29, 0.5.0 Nr. 6): ab „eingereicht“; eine nachgetragene Anmeldung ohne
 * Einreichungstag ab der Eintragung. Davor ist an der Anmeldung nichts offen — einen verspäteten Wechsel trägt bis dahin
 * die überfällige Registerfrist mit dem Hinweis auf § 20a Abs. 2 GwG. Die eine Bedingung für Warnung, Frist und Seite.
 */
export const transparencyChecksDueInternal = (filing: Pick<FilingRow, 'submittedOn' | 'registeredOn'>): boolean => filing.submittedOn !== null || filing.registeredOn !== null;

/** Die Prüffragen samt Ergebnis; Frage 1 berechnet, Fragen 2–4 wie gespeichert. */
export function transparencyViewInternal(filing: Pick<FilingRow, 'transparency' | 'submittedOn' | 'registeredOn'>, occasions: Pick<OccasionRow, 'kind' | 'occurredOn'>[], today: string, dueOn: (occurredOn: string) => string): TransparencyView {
  const stored = transparencyCheckOf(filing.transparency);
  const first = occasions.filter((o) => APPLICABLE.includes(o.kind)).map((o) => o.occurredOn).sort()[0];
  const promptlyBy = first === undefined ? null : dueOn(first);
  const notFiledPromptly = notFiledPromptlyOf(filing, promptlyBy, today);
  const check: TransparencyCheck = { ...stored, answers: { ...(notFiledPromptly === undefined ? {} : { notFiledPromptly }), ...stored.answers } };
  return { ...check, result: transparencyResultInternal(check, occasions), promptlyBy, due: transparencyChecksDueInternal(filing) };
}

/**
 * Meldung an das Transparenzregister nötig — ab der Einreichung (`due`), bis die Bestätigung der Meldung abgelegt ist: weil der Wechsel nicht
 * unverzüglich zum Vereinsregister angemeldet ist (Frage 1, berechnet, § 20a Abs. 2 Nr. 1 GwG) oder weil eine der Fragen
 * 2–4 mit „ja“ beantwortet ist (§ 20a Abs. 2 Nr. 2, 3 GwG). Offene Fragen 2–4 erzeugen keine Frist (Joe 2026-10-28),
 * eine bejahte schon: Dann besteht die Pflicht.
 */
export const transparencyReportDueInternal = (view: TransparencyView): boolean => view.due && view.result === 'reportNeeded' && !view.confirmationDocumentId;

/** Fragen 2–4 noch offen an einem berührenden, eingereichten Vorgang — Warnung ab dem Einreichen, nie eine Sperre. */
export const transparencyChecksOpenInternal = (view: TransparencyView): boolean => view.due && view.promptlyBy !== null && TRANSPARENCY_MANUAL_KEYS.some((k) => view.answers[k] === undefined);
