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

export interface InvalidField {
  /** Der Schlüssel, unter dem das Formular den Namen führt — ein Sprachfeld unter seinem Rumpf. */
  key: string;
  /** Der Feldname aus dem Formular; `null`, wenn es keinen mitgab (dann nie den Schlüssel zeigen). */
  label: string | null;
  /** Die Meldungen des Felds, jede einmal (zwei Sprachen mit derselben Meldung: eine). */
  messages: string[];
}

/**
 * Die betroffenen Felder mit ihren Meldungen, in der Reihenfolge der Fehler.
 * Ein Sprachfeld (`summary.de`, `summary.en`) erscheint einmal unter seinem
 * Rumpf. Führt das Formular einen Schlüssel mit Punkt selbst als Feld (die
 * Einstellungen: `organization.name`), gilt der ganze Schlüssel.
 */
export function invalidFields(errors: Record<string, string>, labels: Record<string, string>): InvalidField[] {
  const groups = new Map<string, InvalidField>();
  for (const [path, message] of Object.entries(errors)) {
    const key = labels[path] !== undefined ? path : stemOf(path);
    const group = groups.get(key) ?? { key, label: labels[key] ?? null, messages: [] };
    if (!group.messages.includes(message)) group.messages.push(message);
    groups.set(key, group);
  }
  return [...groups.values()];
}
