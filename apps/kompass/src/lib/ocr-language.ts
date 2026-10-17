/**
 * Klarname einer Sprache der Texterkennung (Tesseract: ISO 639-2, z. B. `deu`, Varianten wie `chi_sim`), 11-1 C36.
 * Kennt `Intl.DisplayNames` den Code nicht, steht der Name der Grundsprache mit dem Code dahinter, sonst der Code.
 */
export function ocrLanguageName(code: string, locale: string): string {
  const names = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' });
  const of = (c: string): string | null => {
    try {
      return names.of(c) ?? null;
    } catch {
      return null;
    }
  };
  const direct = of(code);
  if (direct) return direct;
  const base = code.includes('_') ? of(code.split('_')[0]!) : null;
  return base ? `${base} (${code})` : code;
}
