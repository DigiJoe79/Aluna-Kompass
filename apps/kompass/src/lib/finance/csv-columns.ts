import { splitValues, type AssistantState, type ColumnRole } from './csv-assistant-state';

/**
 * Schritt 3 des CSV-Assistenten als Liste (Spec 2026-10-22, Backlog 80): Pflichtpunkte, doppelte Rollen, Beispielwerte,
 * Gruppen beim Betreten und Suche — reine Funktionen ohne React, damit sie ohne DOM testbar sind.
 */
export type RequirementKey = 'bookingDate' | 'amount' | 'nameOrPurpose' | 'indicatorValues' | 'pendingValues';

export interface RequiredCheck {
  key: RequirementKey;
  done: boolean;
  /** Namen der zugeordneten Spalten in Dateireihenfolge. */
  columns: string[];
}

const roleAt = (state: AssistantState, index: number): ColumnRole => state.roles[index] ?? 'ignore';

/** Die Pflichtpunkte: immer Buchungstag, Betrag, Name oder Zweck; die Wertefelder nur, wenn ihre Spalte eine Rolle hat. */
export function requiredChecks(header: string[], state: AssistantState): RequiredCheck[] {
  const columnsOf = (...roles: ColumnRole[]) => header.filter((_, i) => roles.includes(roleAt(state, i)));
  const count = (role: ColumnRole) => header.filter((_, i) => roleAt(state, i) === role).length;
  const single = count('amount') > 0;
  const debit = count('debit') > 0;
  const credit = count('credit') > 0;
  const checks: RequiredCheck[] = [
    { key: 'bookingDate', done: count('bookingDate') > 0, columns: columnsOf('bookingDate') },
    // Wie `buildFormat` samt Formatschema: entweder ein Betrag mit Vorzeichen oder Soll und Haben, nie gemischt.
    { key: 'amount', done: single ? !debit && !credit : debit && credit, columns: columnsOf('amount', 'debit', 'credit') },
    { key: 'nameOrPurpose', done: count('counterpartyName') > 0 || count('purpose') > 0, columns: columnsOf('counterpartyName', 'purpose') },
  ];
  if (count('indicator') > 0) checks.push({ key: 'indicatorValues', done: splitValues(state.indicatorValues).length > 0, columns: columnsOf('indicator') });
  if (count('pending') > 0) checks.push({ key: 'pendingValues', done: splitValues(state.pendingValues).length > 0, columns: columnsOf('pending') });
  return checks;
}

/** Alle Spalten, deren Rolle (außer „ignorieren“) mehr als einmal vergeben ist. */
export function duplicateRoleIndices(roles: ColumnRole[]): Set<number> {
  const seen = new Map<ColumnRole, number[]>();
  roles.forEach((role, i) => {
    if (role !== 'ignore') seen.set(role, [...(seen.get(role) ?? []), i]);
  });
  return new Set([...seen.values()].filter((indices) => indices.length > 1).flat());
}

/** Verschiedene, nicht leere Werte einer Spalte in der Reihenfolge ihres ersten Auftretens, höchstens `max`. */
export function sampleValues(rows: string[][], index: number, max: number): string[] {
  const values: string[] = [];
  for (const row of rows) {
    const value = (row[index] ?? '').trim();
    if (value !== '' && !values.includes(value)) values.push(value);
    if (values.length >= max) break;
  }
  return values;
}

/** Die Gruppen beim Betreten des Schritts: Spalten mit Rolle und die übrigen. */
export function entryGroups(roles: ColumnRole[]): { withRole: number[]; more: number[] } {
  const withRole: number[] = [];
  const more: number[] = [];
  roles.forEach((role, i) => (role === 'ignore' ? more : withRole).push(i));
  return { withRole, more };
}

/** Suche unter „Weitere Spalten“: Spaltenname und alle Vorschauwerte, Groß/klein egal. */
export function matchesColumn(header: string[], rows: string[][], index: number, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [header[index] ?? '', ...rows.map((row) => row[index] ?? '')].some((value) => value.toLowerCase().includes(needle));
}

/** Umbruchstellen eines Werts: E-Mail-Adressen nur nach „@“ und „.“ (das Zeichen bleibt vorn), sonst der Wert ganz. */
export function breakableParts(value: string): string[] {
  if (!value.includes('@')) return [value];
  return value.match(/[^@.]*[@.]|[^@.]+$/g) ?? [value];
}
