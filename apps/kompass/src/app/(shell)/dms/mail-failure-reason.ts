/** Wie `next-intl`s Übersetzer für `dms.mailErrorCodes` — nur, was hier gebraucht wird. */
interface CodeTranslator {
  (key: string): string;
  has(key: string): boolean;
}

/**
 * Der Grund einer gescheiterten Sendung im Ausgangskorb: der gekürzte Text des Servers und die Fehlerart. Eine Art mit
 * eigenem Satz (`interrupted`: Absturz mitten im Senden, Zustellung unklar) steht als Satz da, die übrigen wie bisher
 * in Klammern.
 */
export function mailFailureReason(t: CodeTranslator, code: string | null, text: string | null): string {
  const label = code ? (t.has(code) ? t(code) : `(${code})`) : null;
  return [text, label].filter(Boolean).join(' ');
}
