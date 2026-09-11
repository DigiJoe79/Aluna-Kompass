/**
 * Fehler in einem Formular mit Reitern sichtbar machen.
 *
 * Ein Fehler im hinteren Reiter ist ein Fehler, den niemand sieht: Das Formular
 * springt nicht dorthin, und der vordere Reiter zeigt nichts an. Der Nutzer
 * drückt Speichern, es passiert scheinbar nichts, und er hält es für kaputt.
 */

/** Sprachfelder melden als `summary.de`; deklariert ist der Rumpf `summary`. */
const stemOf = (key: string) => key.split('.')[0] ?? key;

export interface TabFields {
  key: string;
  fields: readonly string[];
}

export function invalidTabs(
  tabs: readonly TabFields[],
  errors: Record<string, string>,
): Set<string> {
  const stems = new Set(Object.keys(errors).map(stemOf));
  return new Set(tabs.filter((tab) => tab.fields.some((f) => stems.has(f))).map((tab) => tab.key));
}

/** Wie viele Felder betroffen sind — ein Sprachfeld einmal, nicht je Sprache. */
export function countInvalidFields(errors: Record<string, string>): number {
  return new Set(Object.keys(errors).map(stemOf)).size;
}
