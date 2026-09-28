export interface DiffRow {
  key: string;
  before: string | null;
  after: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * D7: Ein Modul, das keine Werte protokolliert (Kontakte, Befund 48), schreibt nur `after.changedFields` — die Namen
 * der geänderten Felder. Das ist keine Vorher/Nachher-Zeile, sondern eine eigene Aussage; `null`, wenn es fehlt.
 */
export function changedFieldsOf(after: unknown): string[] | null {
  if (!isObject(after) || !Array.isArray(after.changedFields)) return null;
  return after.changedFields.filter((f): f is string => typeof f === 'string');
}

export function diffFields(before: unknown, after: unknown): DiffRow[] {
  if (changedFieldsOf(after) !== null) {
    const { changedFields: _names, ...rest } = after as Record<string, unknown>;
    return Object.keys(rest).length === 0 && (before === undefined || before === null) ? [] : diffFields(before, rest);
  }
  if (before === undefined && after === undefined) return [];
  if (!isObject(before) && !isObject(after)) {
    if (before === null && after === null) return [];
    return [{ key: 'value', before: show(before), after: show(after) }];
  }
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => ({ key: k, before: show(b[k]), after: show(a[k]) }));
}
