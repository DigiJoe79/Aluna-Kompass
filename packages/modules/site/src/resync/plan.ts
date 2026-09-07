import type { FieldSchema } from '../load';

/** Verlustfreie Typumformungen: von → nach. Alles andere gilt als Verlust. */
const LOSSLESS: Record<string, string[]> = { text: ['list', 'markdown'], number: ['text'], select: ['text'], markdown: ['text'] };

export interface CollectionSchema {
  label?: string;
  max?: number;
  renamedFrom?: string;
  fields?: Record<string, FieldSchema>;
}

export interface ResyncSchema {
  variables?: Record<string, FieldSchema>;
  collections?: Record<string, CollectionSchema>;
}

export interface ResyncData {
  variables?: Record<string, unknown>;
  collections?: Record<string, Array<Record<string, unknown>>>;
}

export type Finding =
  | { kind: 'added'; path: string; label?: string }
  | { kind: 'renamed'; path: string; label?: string; from: string; filled: number }
  | { kind: 'removed'; path: string; label?: string; filled: number }
  | { kind: 'retyped'; path: string; label?: string; from: string; to: string; filled: number; lossless: boolean }
  | { kind: 'overLimit'; path: string; label?: string; have: number; max: number }
  | { kind: 'valueGone'; path: string; label?: string; value: string; count: number; replacement: string };

export interface FieldDesc {
  path: string;
  name: string;
  scope: 'variable' | 'collection';
  collection?: string;
  kind: string;
  label?: string;
  schema: FieldSchema;
}

/** Die Art eines Feldes aus dem JSON-Schema: `widget` wenn gesetzt, sonst `type`. */
export function kindOf(schema: FieldSchema): string {
  if (typeof schema.widget === 'string') return schema.widget;
  if (Array.isArray((schema as { enum?: unknown }).enum)) return 'select';
  const type = (schema as { type?: string }).type;
  if (type === 'array') return 'list';
  if (type === 'string') return 'text';
  if (type === 'number' || type === 'integer') return 'number';
  return type ?? 'unknown';
}

/** Jedes Feld eines Schemas mit seinem Pfad: `variables.<n>` oder `collections.<c>[].<f>`. */
export function flatten(schema: ResyncSchema): FieldDesc[] {
  const out: FieldDesc[] = [];
  for (const [name, s] of Object.entries(schema.variables ?? {})) {
    out.push({ path: `variables.${name}`, name, scope: 'variable', kind: kindOf(s), label: s.label, schema: s });
  }
  for (const [collection, c] of Object.entries(schema.collections ?? {})) {
    for (const [name, s] of Object.entries(c.fields ?? {})) {
      out.push({ path: `collections.${collection}[].${name}`, name, scope: 'collection', collection, kind: kindOf(s), label: s.label, schema: s });
    }
  }
  return out;
}

const byPath = (fields: FieldDesc[]) => new Map(fields.map((f) => [f.path, f]));

/** Ersetzt das letzte Namenssegment eines Pfades: `variables.lede` → `variables.subtitle`. */
const siblingPath = (path: string, name: string) => path.replace(/[^.[\]]+$/, name);

function hasContent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(hasContent);
  return false;
}

/** Die vorhandenen Werte eines Feldes — eine Liste, bei Variablen mit einem Eintrag. */
function valuesAt(path: string, data: ResyncData): unknown[] {
  const collectionMatch = /^collections\.([^.[\]]+)\[\]\.(.+)$/.exec(path);
  if (collectionMatch) {
    const [, collection, field] = collectionMatch;
    return (data.collections?.[collection!] ?? []).map((entry) => entry[field!]);
  }
  const variableMatch = /^variables\.(.+)$/.exec(path);
  if (variableMatch) return [data.variables?.[variableMatch[1]!]];
  return [];
}

const countFilled = (path: string, data: ResyncData) => valuesAt(path, data).filter(hasContent).length;
const countValue = (path: string, data: ResyncData, value: string) => valuesAt(path, data).filter((v) => v === value).length;

/** Vergleicht zwei eingelesene Schemata gegen die vorhandenen Daten. */
export function planResync(before: ResyncSchema, after: ResyncSchema, data: ResyncData): Finding[] {
  const beforeFields = byPath(flatten(before));
  const afterFields = byPath(flatten(after));

  // afterPfad → beforePfad für deklarierte Umbenennungen, plus die verbrauchten
  // beforePfade, die dann kein `removed` mehr ergeben.
  const renames = new Map<string, string>();
  const consumed = new Set<string>();
  for (const [path, desc] of afterFields) {
    const from = (desc.schema as { renamedFrom?: string }).renamedFrom;
    if (from) {
      const fromPath = siblingPath(path, from);
      renames.set(path, fromPath);
      consumed.add(fromPath);
    }
  }
  for (const c of Object.values(after.collections ?? {})) {
    if (c.renamedFrom) consumed.add(`collections.${c.renamedFrom}`);
  }

  const findings: Finding[] = [];

  // 1. Neue und umbenannte Felder aus `after`.
  for (const [path, desc] of afterFields) {
    if (renames.has(path)) {
      const from = renames.get(path)!;
      findings.push({ kind: 'renamed', path, label: desc.label, from, filled: countFilled(from, data) });
    } else if (!beforeFields.has(path)) {
      findings.push({ kind: 'added', path, label: desc.label });
    }
  }
  for (const [collection, c] of Object.entries(after.collections ?? {})) {
    const path = `collections.${collection}`;
    if (!before.collections?.[collection] && !c.renamedFrom) findings.push({ kind: 'added', path, label: c.label });
  }

  // 2. Entfallene Felder und Sammlungen.
  for (const [path, desc] of beforeFields) {
    if (consumed.has(path) || afterFields.has(path)) continue;
    if (after.collections?.[desc.collection ?? ''] === undefined && desc.scope === 'collection') continue; // ganze Sammlung: unten
    findings.push({ kind: 'removed', path, label: desc.label, filled: countFilled(path, data) });
  }
  for (const collection of Object.keys(before.collections ?? {})) {
    const path = `collections.${collection}`;
    if (after.collections?.[collection] || consumed.has(path)) continue;
    const filled = (data.collections?.[collection] ?? []).filter((entry) => hasContent(entry)).length;
    findings.push({ kind: 'removed', path, label: before.collections?.[collection]?.label, filled });
  }

  // 3. Typwechsel.
  for (const [path, desc] of beforeFields) {
    const next = afterFields.get(path);
    if (!next || next.kind === desc.kind) continue;
    const lossless = (LOSSLESS[desc.kind] ?? []).includes(next.kind);
    findings.push({ kind: 'retyped', path, label: next.label, from: desc.kind, to: next.kind, filled: countFilled(path, data), lossless });
  }

  // 4. Verschärfte Grenzen.
  for (const [collection, c] of Object.entries(before.collections ?? {})) {
    const next = after.collections?.[collection];
    if (!next || next.max === undefined) continue;
    if (c.max !== undefined && next.max >= c.max) continue;
    const have = (data.collections?.[collection] ?? []).length;
    if (have > next.max) findings.push({ kind: 'overLimit', path: `collections.${collection}`, label: next.label, have, max: next.max });
  }

  // 5. Entfallene Aufzählungswerte.
  for (const [path, desc] of beforeFields) {
    const next = afterFields.get(path);
    if (!next) continue;
    const beforeEnum = (desc.schema as { enum?: string[] }).enum;
    const afterEnum = (next.schema as { enum?: string[] }).enum;
    if (!Array.isArray(beforeEnum) || !Array.isArray(afterEnum)) continue;
    for (const value of beforeEnum.filter((v) => !afterEnum.includes(v))) {
      const count = countValue(path, data, value);
      if (count > 0) findings.push({ kind: 'valueGone', path, label: next.label, value, count, replacement: afterEnum[0]! });
    }
  }

  return findings;
}

/** Wahr, wenn ein Befund gefüllte Daten kostet und deshalb bestätigt werden muss. */
export function losesContent(finding: Finding): boolean {
  switch (finding.kind) {
    case 'removed':
      return finding.filled > 0;
    case 'retyped':
      return finding.filled > 0 && !finding.lossless;
    case 'overLimit':
    case 'valueGone':
      return true;
    default:
      return false;
  }
}
