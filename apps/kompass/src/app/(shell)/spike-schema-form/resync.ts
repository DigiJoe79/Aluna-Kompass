// WEGWERF — Feldstudie zum Resync, nicht committen.

type Node = Record<string, unknown> & {
  type?: string;
  properties?: Record<string, Node>;
  items?: Node;
  enum?: string[];
  widget?: string;
  locales?: string[];
  label?: string;
  maxItems?: number;
  renamedFrom?: string;
};

export interface FieldDesc {
  path: string;
  kind: string;
  label: string;
  locales?: string[];
  enum?: string[];
  maxItems?: number;
  renamedFrom?: string;
}

const kindOf = (n: Node): string =>
  n.widget === 'localized' ? 'localized' : n.widget === 'asset' ? 'asset' : n.type === 'array' && n.items?.type === 'object' ? 'objectList' : (n.type ?? 'string');

/** Schema → flache Pfadliste. Listen bekommen `[]` im Pfad, ihre Felder darunter. */
export function flatten(node: Node, prefix = ''): FieldDesc[] {
  const out: FieldDesc[] = [];
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    const kind = kindOf(child);
    out.push({ path, kind, label: (child.label as string) ?? key, locales: child.locales, enum: child.enum, maxItems: child.maxItems as number | undefined, renamedFrom: child.renamedFrom ? (prefix ? `${prefix}.${child.renamedFrom}` : child.renamedFrom) : undefined });
    if (kind === 'objectList') out.push(...flatten(child.items!, `${path}[]`));
  }
  return out;
}

export type Finding =
  | { kind: 'added'; path: string; label: string }
  | { kind: 'renamed'; path: string; label: string; from: string; filled: number }
  | { kind: 'removed'; path: string; label: string; filled: number }
  | { kind: 'retyped'; path: string; label: string; from: string; to: string; filled: number }
  | { kind: 'localeAdded'; path: string; label: string; locale: string }
  | { kind: 'localeRemoved'; path: string; label: string; locale: string; filled: number }
  | { kind: 'overLimit'; path: string; label: string; have: number; max: number }
  | { kind: 'valueGone'; path: string; label: string; value: string; count: number };

/** Alle Werte an einem Pfad einsammeln; `[]` fächert über Listeneinträge auf. */
function valuesAt(data: unknown, path: string): unknown[] {
  const parts = path.split('.');
  let current: unknown[] = [data];
  for (const part of parts) {
    const isList = part.endsWith('[]');
    const key = isList ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const item of current) {
      const v = (item as Record<string, unknown>)?.[key];
      if (v === undefined) continue;
      if (isList && Array.isArray(v)) next.push(...v);
      else next.push(v);
    }
    current = next;
  }
  return current;
}

const isFilled = (v: unknown): boolean =>
  v != null && v !== '' && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && Object.values(v as object).every((x) => x === '' || x == null));

const filledCount = (data: unknown, path: string) => valuesAt(data, path).filter(isFilled).length;

/** Was ein Wechsel von `before` nach `after` mit `data` anstellt. */
export function planResync(before: Node, after: Node, data: unknown): Finding[] {
  const old = new Map(flatten(before).map((f) => [f.path, f]));
  const next = new Map(flatten(after).map((f) => [f.path, f]));
  const findings: Finding[] = [];

  // Umbenennungen muss das Template deklarieren — geraten werden können sie nicht.
  const renamedAway = new Map<string, FieldDesc>();
  for (const f of next.values()) if (f.renamedFrom && old.has(f.renamedFrom)) renamedAway.set(f.renamedFrom, f);

  for (const [path, f] of next) {
    if (old.has(path)) continue;
    if (f.renamedFrom && old.has(f.renamedFrom)) findings.push({ kind: 'renamed', path, label: f.label, from: f.renamedFrom, filled: filledCount(data, f.renamedFrom) });
    else findings.push({ kind: 'added', path, label: f.label });
  }

  for (const [path, f] of old) {
    if (renamedAway.has(path)) continue;
    const to = next.get(path);
    if (!to) {
      findings.push({ kind: 'removed', path, label: f.label, filled: filledCount(data, path) });
      continue;
    }
    if (to.kind !== f.kind) {
      findings.push({ kind: 'retyped', path, label: f.label, from: f.kind, to: to.kind, filled: filledCount(data, path) });
      continue;
    }
    for (const l of f.locales ?? []) {
      if (!(to.locales ?? []).includes(l)) {
        const filled = valuesAt(data, path).filter((v) => isFilled((v as Record<string, unknown>)?.[l])).length;
        findings.push({ kind: 'localeRemoved', path, label: f.label, locale: l, filled });
      }
    }
    for (const l of to.locales ?? []) if (!(f.locales ?? []).includes(l)) findings.push({ kind: 'localeAdded', path, label: f.label, locale: l });

    if (to.maxItems !== undefined) {
      const have = Math.max(0, ...valuesAt(data, path).map((v) => (Array.isArray(v) ? v.length : 0)));
      if (have > to.maxItems) findings.push({ kind: 'overLimit', path, label: f.label, have, max: to.maxItems });
    }
    for (const v of f.enum ?? []) {
      if (!(to.enum ?? []).includes(v)) {
        const count = valuesAt(data, path).filter((x) => x === v).length;
        if (count > 0) findings.push({ kind: 'valueGone', path, label: f.label, value: v, count });
      }
    }
  }
  return findings;
}

/** Verliert dieser Befund Inhalt? Nur solche brauchen eine Bestätigung. */
export const losesContent = (f: Finding): boolean =>
  (f.kind === 'removed' && f.filled > 0) ||
  (f.kind === 'retyped' && f.filled > 0) ||
  (f.kind === 'localeRemoved' && f.filled > 0) ||
  f.kind === 'overLimit' ||
  f.kind === 'valueGone';
