/** Die Finanzrechte der Rolle Kassenprüfer (Spec 0.4.0 § Rechte): lesen, Überblick, prüfen. */
const AUDITOR_ONLY = ['finance.audit', 'finance.overview', 'finance.read'];

/**
 * Wohin `/finance` führt (Plan D1b, Board 1b): Wer in den Finanzen genau die Rechte der Prüferrolle hat, landet auf der
 * Kassenprüfung; alle anderen im Journal. Rechte anderer Module zählen nicht.
 */
export function financeLandingPath(permissions: ReadonlySet<string>): '/finance/audit' | '/finance/entries' {
  const finance = [...permissions].filter((p) => p.startsWith('finance.')).sort();
  return finance.length === AUDITOR_ONLY.length && finance.every((p, i) => p === AUDITOR_ONLY[i]) ? '/finance/audit' : '/finance/entries';
}
