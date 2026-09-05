export interface DiffRow {
  key: string;
  before: string | null;
  after: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

export function diffFields(before: unknown, after: unknown): DiffRow[] {
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
