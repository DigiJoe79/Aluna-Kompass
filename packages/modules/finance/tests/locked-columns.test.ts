import { describe, expect, it } from 'vitest';
import { setupFinance } from './helpers';

/**
 * Mechanischer Wächter über alle gesperrten Finanztabellen (Testdurchsicht 2026-10-22, Plan P4 Task 3; Muster bis
 * dahin nur für vier Tabellen in `entry-immutability.test.ts`): Hat eine Tabelle einen BEFORE-UPDATE-Trigger, steht
 * jede ihrer Spalten in der `UPDATE OF`-Liste eines ihrer Trigger (ein Trigger ohne Liste bewacht alle), oder sie
 * steht hier als ausdrücklich frei. Fällt eine neue Spalte durch beide Raster, ließe sie sich an einem gesperrten
 * Datensatz ändern, ohne dass ein Trigger es bemerkt. Ob ein Trigger im richtigen Zustand greift (WHEN), prüfen die
 * Schema-Tests der Bereiche; hier geht es nur darum, dass keine Spalte vergessen ist. Gelesen wird der geltende Stand
 * aus der Datenbank, nicht aus den Migrationen.
 */
const FREE: Record<string, { columns: readonly string[]; reason: string }> = {
  finance_entries: { columns: ['reversed_by_entry_id', 'updated_at'], reason: 'Der Rückverweis entsteht erst mit dem Storno (Spec 5.2).' },
  finance_money_lines: { columns: ['raw_released_at'], reason: 'Die Freigabe des Rohumsatzes nach einem Storno; raw_transaction_id nur von leer zu einem Wert.' },
  finance_allocation_lines: { columns: ['contact_id', 'project_id', 'purpose_id', 'abroad'], reason: 'Bezug, Projekt, Zweck und Ausland ändert die Bezugskorrektur (E18) an der festgeschriebenen Zeile.' },
  finance_entry_documents: { columns: ['document_deleted_at'], reason: 'Vermerk der Akte, wenn ihr Dokument gelöscht ist.' },
  finance_allocation_corrections: {
    columns: ['id', 'state', 'proof_document_id', 'section_153', 'approved_by_user_id', 'approved_at', 'rejected_by_user_id', 'rejected_at', 'reject_note', 'purpose_negative_reason'],
    reason: 'Die Entscheidung über den Antrag; der Antrag selbst ist gesperrt.',
  },
  finance_notices: {
    columns: ['id', 'kind', 'tax_office', 'tax_number', 'notice_date', 'assessment_period', 'purposes_text', 'purposes_text_accusative', 'exempt_from', 'document_id', 'created_at', 'created_by_user_id', 'updated_at'],
    reason: 'Ein Bescheid bleibt bearbeitbar, bis er abgelöst oder storniert ist (saveNotice); gesperrt sind Ablösung und Storno.',
  },
  finance_import_candidates: {
    columns: ['line'],
    reason: 'Die rohe Bankzeile trägt Namen und IBAN; die Anonymisierung nach Fristablauf (Personenbezug entfernen) muss sie leeren können.',
  },
};

/** Tabellen mit BEFORE-UPDATE-Trigger, der nichts sperrt, sondern eine Bedingung prüft — mit Grund. */
const NOT_LOCKED: Record<string, string> = {
  finance_accounts: 'Der Trigger prüft nur, dass Importformat und -profil zusammenpassen; das Konto bleibt bearbeitbar.',
};

describe('every column of a locked finance table is guarded or explicitly free', () => {
  const { deps } = setupFinance();
  const triggers = deps.sqlite.prepare("select tbl_name as tableName, sql from sqlite_master where type = 'trigger' and tbl_name like 'finance\\_%' escape '\\'").all() as { tableName: string; sql: string }[];
  const columnsOf = (table: string) => (deps.sqlite.prepare(`pragma table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
  /** Je Tabelle die bewachten Spalten; ein BEFORE UPDATE ohne `OF` bewacht alle. */
  const guarded = new Map<string, Set<string>>();
  for (const { tableName, sql } of triggers) {
    const of = /BEFORE UPDATE OF ([^\n]+?) ON/.exec(sql);
    if (!of && !/BEFORE UPDATE ON/.test(sql)) continue;
    const set = guarded.get(tableName) ?? new Set<string>();
    for (const column of of ? of[1]!.split(',').map((c) => c.trim()) : columnsOf(tableName)) set.add(column);
    guarded.set(tableName, set);
  }
  const locked = [...guarded.keys()].filter((table) => !(table in NOT_LOCKED)).sort();

  it('finds the locked tables', () => {
    expect(locked.length).toBeGreaterThan(20);
    expect(Object.keys(NOT_LOCKED).filter((table) => !guarded.has(table))).toEqual([]);
  });

  it.each(locked)('%s', (table) => {
    const free = new Set(FREE[table]?.columns ?? []);
    expect(columnsOf(table).filter((column) => !guarded.get(table)!.has(column) && !free.has(column))).toEqual([]);
    // Die Liste bleibt ehrlich: Was frei heißt, gibt es und bewacht kein Trigger.
    expect([...free].filter((column) => !columnsOf(table).includes(column) || guarded.get(table)!.has(column))).toEqual([]);
  });

  it('names no free columns for a table that is not locked', () => {
    expect(Object.keys(FREE).filter((table) => !locked.includes(table))).toEqual([]);
  });
});
