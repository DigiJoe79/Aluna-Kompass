import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Wächter (Spec Zahlung zuordnen § 3.1, § 7.4): Ein lebender Ausgleich ist überall über `liveSettlementCondition()`
 * definiert. Ein Leser, der die Tabelle der Ausgleiche ohne sie abfragt, zählte eine aufgehobene Zuordnung still mit:
 * offener Rest, freier Rest der Geldzeile, Beitragsstand, Mahnsumme. Geprüft wird jede Abfrage, die die Tabelle in
 * `from(…)` oder einem Join nennt, bis zum Ende ihres Ausdrucks.
 */
const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const p = path.join(dir, name); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });

/** Ausnahmen, je Datei und Funktion, mit Grund. */
const ALLOWED: Record<string, string> = {
  'ledger/entries.ts:releasedSettlementsOf': 'die Spur der Buchung zeigt aufgehobene Zuordnungen bewusst (Design 4c); gezählt wird aus ihr nichts',
};

/** Jede Abfrage ohne Bedingung des lebenden Ausgleichs, als `datei:funktion`. */
export function unfilteredSettlementQueries(file: string, source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/(?:\.from|Join)\(financeOpenItemSettlements\b/g)) {
    const at = match.index!;
    const rest = source.slice(at);
    const end = rest.search(/\.(all|get|run)\(|;\s*$/m);
    const statement = end < 0 ? rest : rest.slice(0, end);
    if (statement.includes('liveSettlementCondition(')) continue;
    const before = source.slice(0, at);
    const names = [...before.matchAll(/(?:function\s+(\w+)|const\s+(\w+)\s*(?::\s*[\w<>[\]]+)?\s*=\s*(?:async\s*)?\()/g)];
    const last = names.at(-1);
    out.push(`${file}:${last ? (last[1] ?? last[2]) : '?'}`);
  }
  return out;
}

describe('a live settlement has one definition', () => {
  it('every query on the settlements table filters through liveSettlementCondition, or stands in the allow list', () => {
    const offenders = files(SRC).flatMap((f) => unfilteredSettlementQueries(path.relative(SRC, f).split(path.sep).join('/'), readFileSync(f, 'utf8'))).filter((k) => !(k in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it('catches a reader without the condition (Gegenprobe)', () => {
    const fixture = `function sumOf(db) {\n  return db.select().from(financeOpenItemSettlements).where(eq(financeOpenItemSettlements.openItemId, id)).all();\n}\nfunction good(db) {\n  return db.select().from(financeOpenItemSettlements).where(and(eq(a, b), liveSettlementCondition())).all();\n}\n`;
    expect(unfilteredSettlementQueries('x.ts', fixture)).toEqual(['x.ts:sumOf']);
  });
});
