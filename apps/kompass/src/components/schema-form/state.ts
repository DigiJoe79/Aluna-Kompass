import { blankValue, widgetOf, type FieldSchema } from '@kompass/module-site';

/** Setzt `next` unter `path` (`title.de`, `blocks.2.href`) und lässt alles andere unberührt. */
export function setAtPath(value: unknown, path: string, next: unknown): unknown {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) return next;
  const [head, ...rest] = segments;
  const key = head!;
  if (/^\d+$/.test(key)) {
    const index = Number(key);
    const arr = Array.isArray(value) ? [...(value as unknown[])] : [];
    arr[index] = rest.length ? setAtPath(arr[index], rest.join('.'), next) : next;
    return arr;
  }
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  obj[key] = rest.length ? setAtPath(obj[key], rest.join('.'), next) : next;
  return obj;
}

/** Der Leerwert eines Feldes; mehrsprachige Felder bekommen je Sprache eine leere Zeichenkette. */
export function blankFor(field: FieldSchema, locales: string[] = []): unknown {
  if (widgetOf(field) === 'localized') return Object.fromEntries(locales.map((l) => [l, '']));
  return blankValue(field);
}

/** Füllt einen Datensatz für die Maske auf: fehlende Felder mit Leerwert, mehrsprachige um fehlende Sprachen ergänzt. */
export function withBlanks(schema: Record<string, FieldSchema>, current: Record<string, unknown>, locales: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const value = current[key];
    if (value === undefined || value === null) {
      out[key] = blankFor(field, locales);
    } else if (widgetOf(field) === 'localized' && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...Object.fromEntries(locales.map((l) => [l, ''])), ...(value as Record<string, unknown>) };
    } else {
      out[key] = value;
    }
  }
  return out;
}
