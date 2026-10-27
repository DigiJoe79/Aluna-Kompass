/**
 * Rechenschaft C (Spec § C Schritt 1): rein, ohne Datenbank — Export `@kompass/module-finance/statement-rules`, damit
 * die Oberfläche denselben Maßstab zeigt wie der Dienst.
 */

/**
 * Deckt ein Auszug bis `periodTo` den Stichtag `endsOn`? Ja, wenn er bis dahin reicht — oder wenn er im letzten Monat
 * des Jahres endet und danach im Jahr nichts mehr auf dem Konto bewegt wurde (Auszug bis 30.12., Claude 2026-10-24).
 */
export function statementCoversYearEnd(periodTo: string, endsOn: string, lastMovementOn: string | null): boolean {
  if (periodTo >= endsOn) return true;
  if (periodTo.slice(0, 7) !== endsOn.slice(0, 7)) return false;
  return lastMovementOn === null || lastMovementOn <= periodTo;
}

const DATE = /(\d{1,2})\.(\d{1,2})\.(\d{4})/g;
const RANGE = /(\d{1,2}\.\d{1,2}\.\d{4})\s*(?:bis|–|-|—)\s*(\d{1,2}\.\d{1,2}\.\d{4})/;

/** Ein Kalendertag aus Teilen — `null`, wenn es ihn nicht gibt (31.02.). Rein, ohne Zeitzone. */
function isoOf(day: string, month: string, year: string): string | null {
  const [y, m, d] = [Number(year), Number(month), Number(day)];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseOne(text: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  return m ? isoOf(m[1]!, m[2]!, m[3]!) : null;
}

/**
 * Der Zeitraum eines Kontoauszugs aus seinem Text: „01.12.2025 bis 31.12.2025“ (auch mit Strich) ergibt beide Enden,
 * sonst gilt das späteste Datum im Text als Ende. Ohne gültiges Datum `null` — ein Vorschlag, nie eine Festlegung.
 */
export function suggestPeriodFromText(text: string): { periodFrom: string | null; periodTo: string } | null {
  const range = RANGE.exec(text);
  if (range) {
    const from = parseOne(range[1]!);
    const to = parseOne(range[2]!);
    if (from && to && from <= to) return { periodFrom: from, periodTo: to };
  }
  const dates = [...text.matchAll(DATE)].map((m) => isoOf(m[1]!, m[2]!, m[3]!)).filter((d): d is string => d !== null).sort();
  const latest = dates.at(-1);
  return latest ? { periodFrom: null, periodTo: latest } : null;
}
