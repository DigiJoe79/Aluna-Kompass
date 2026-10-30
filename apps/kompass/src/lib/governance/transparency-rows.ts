import type { ManualTransparencyKey, TransparencyResult, TransparencyView } from '@kompass/module-governance';

const MANUAL: readonly ManualTransparencyKey[] = ['foreignBoardMember', 'earlierOwnReport', 'controlOtherwise'];
type Answer = 'yes' | 'no' | null;

/**
 * Die Fragen zum Transparenzregister so, wie die Seite sie stellt (Rückmeldung Phase 2). Frage 1 ist umgedreht: Im
 * Modell heißt `notFiledPromptly: true` „Meldung nötig“, auf der Seite „Wurde … unverzüglich angemeldet?“ — „nein“.
 * Das Ergebnis rechnet wie das Modul: ein Grund zur Meldung → nötig; alle beantwortet ohne Grund → keine; sonst offen.
 * `reportNotice`: der Hinweis „Meldung nötig“ erst, wenn die Prüffragen zählen (`due`, ab der Einreichung — 0.5.0 Nr. 6).
 */
export function transparencyRows(t: Pick<TransparencyView, 'answers' | 'promptlyBy' | 'result' | 'due'>, submittedOn: string | null = null) {
  const n = t.answers.notFiledPromptly;
  const q1 =
    n === false ? { value: 'yes' as const, reason: 'submittedInTime' as const, on: submittedOn ?? t.promptlyBy }
    : n === true ? { value: 'no' as const, reason: 'notInTime' as const, on: t.promptlyBy }
    : { value: 'open' as const, reason: 'openUntil' as const, on: t.promptlyBy };
  const manual = Object.fromEntries(MANUAL.map((k) => [k, t.answers[k] === true ? 'yes' : t.answers[k] === false ? 'no' : null])) as Record<ManualTransparencyKey, Answer>;
  const all = [n, ...MANUAL.map((k) => t.answers[k])];
  const result: TransparencyResult = t.result === 'notApplicable' ? 'notApplicable' : all.some((a) => a === true) ? 'reportNeeded' : all.every((a) => a === false) ? 'noReportNeeded' : 'open';
  return { q1, manual, result, reportNotice: t.due && result === 'reportNeeded' };
}
