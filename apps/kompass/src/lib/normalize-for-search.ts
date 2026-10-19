/**
 * Suchschlüssel für eine Suche auf dem Rechner: Groß/klein, Akzente, Umlaute samt ihrer Umschreibung (ä/ae → a)
 * und ß/ss/s fallen zusammen, Leerraum wird ein Leerzeichen. So findet „wiesner“ „Wießner“ und „mueller“ „Müller“.
 * Beide Seiten gehen durch dieselbe Faltung — dass „ue“ auch in „Bauer“ gefaltet wird, trifft Eingabe und Text
 * gleich und kostet höchstens einen überzähligen Treffer.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/s+/g, 's')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jedes Wort der Suche steht in einem der Texte (Wortteil genügt); eine leere Suche trifft alles. */
export function matchesSearch(query: string, texts: readonly (string | null | undefined)[]): boolean {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystacks = texts.filter((t): t is string => !!t).map(normalizeForSearch);
  return words.every((word) => haystacks.some((h) => h.includes(word)));
}
