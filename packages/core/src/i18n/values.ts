import { LOCALE_CODE } from './locales';

/**
 * Erkennt einen mehrsprachigen Wert an seinen Schlüsseln: Alle müssen
 * eingerichtete Sprachen sein. Ein Manifest wie `{ 'en/index.html': … }` oder
 * ein Datensatz mit `id` fällt damit heraus, ein `{ de, en }` nicht.
 *
 * Die Werte sind Text oder Textlisten — mehr Formen gibt es nicht, seit
 * `localizedText` und `LocalizedList` die einzigen Quellen sind.
 */
function isLocalizedValue(value: unknown, locales: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  if (!keys.every((k) => LOCALE_CODE.test(k) && locales.includes(k))) return false;
  return Object.values(value).every(
    (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')),
  );
}

const hasContent = (value: unknown): boolean =>
  typeof value === 'string' ? value.length > 0 : Array.isArray(value) && value.length > 0;

/**
 * Entfernt eine Sprache aus jedem mehrsprachigen Wert, egal wie tief er liegt.
 * Gibt den Eingabewert unverändert zurück, wenn nichts zu tun war — so lässt
 * sich ein Schreibvorgang sparen.
 */
export function stripLocale<T>(value: T, code: string, locales: readonly string[]): T {
  if (isLocalizedValue(value, locales)) {
    if (!(code in value)) return value;
    const { [code]: _removed, ...rest } = value;
    return rest as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const stripped = stripLocale(item, code, locales);
      if (stripped !== item) changed = true;
      return stripped;
    });
    return changed ? (next as T) : value;
  }
  if (typeof value === 'object' && value !== null) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const stripped = stripLocale(item, code, locales);
      if (stripped !== item) changed = true;
      next[key] = stripped;
    }
    return changed ? (next as T) : value;
  }
  return value;
}

/** Wie oft die Sprache irgendwo in diesem Wert Inhalt trägt. */
export function countLocale(value: unknown, code: string, locales: readonly string[]): number {
  if (isLocalizedValue(value, locales)) return hasContent(value[code]) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countLocale(item, code, locales), 0);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).reduce<number>((sum, item) => sum + countLocale(item, code, locales), 0);
  }
  return 0;
}
