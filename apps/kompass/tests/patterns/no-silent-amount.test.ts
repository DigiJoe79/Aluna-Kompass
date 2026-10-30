import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, type CountedAllowlist, isProductSource, lineHits, sourceFiles, SRC } from './source';

/**
 * Ein Betrag wird nicht still zu „kein Betrag“ oder 0 (Code-Review 0.4.0, App-B6/B7): `parseAmount` liefert für leer
 * **und** unlesbar `null`. Wer daraus mit `?? 0`/`?? null` oder `leer ? null : parseAmount(…)` einen Wert macht,
 * speichert einen Tippfehler als „kein Spendenziel“ oder 0 € (Datierte Werte: Freigrenze ab Datum 0 €). Masken lesen
 * Beträge über `readAmount(text, { required })` aus `@/lib/finance/amount` und setzen bei `ok: false` den Feldfehler.
 * Gegenbeispiel mit Grund in der Liste: Rechnen während der Eingabe (Restbetrag, Aufteilen), wo 0 nur angezeigt wird.
 */
const SILENT = [
  // parseAmount(…) ?? …
  /\bparseAmount\((?:[^()]|\([^()]*\))*\)\s*\?\?/g,
  // leer ? null : parseAmount(…)
  /\?\s*null\s*:\s*parseAmount\(/g,
  // bedingung ? parseAmount(…) : null
  /\?\s*parseAmount\((?:[^()]|\([^()]*\))*\)\s*:\s*null\b/g,
];

export function silentAmountCount(line: string): number {
  return SILENT.reduce((n, re) => n + (line.match(re) ?? []).length, 0);
}

/** Pfade relativ zu `src/`. */
export const ALLOWED: CountedAllowlist = {
  'app/(shell)/admin/members/schedule-panel.tsx': { count: 1, reason: 'Beitragsordnung: unlesbar wird −1 €, das der Dienst mit Feldfehler an der Regel ablehnt — nie still gespeichert (Gegenbeispiel der Befundliste).' },
  'app/(shell)/finance/entries/entry-form.tsx': { count: 7, reason: 'Rechnen während der Eingabe (Ausgleich, Rest, gebundene Zeile, Aufteilen); gespeichert wird über toServiceInput, das unlesbare Beträge als Feldfehler meldet.' },
  'app/(shell)/finance/work/mini-entry-form.tsx': { count: 1, reason: 'Aufteilen während der Eingabe; gespeichert wird über die Prüfung der Maske, die unlesbare Beträge meldet.' },
  'app/(shell)/finance/work/suggestion-card.tsx': { count: 1, reason: 'Nur die Zusammenfassung der Zeilen; gespeichert wird über die Prüfung der Maske.' },
  'app/(shell)/finance/purposes/transfer/transfer-form.tsx': { count: 1, reason: 'Unlesbar hält „Zur Freigabe geben“ an und nennt den Betrag als fehlend (`missing.amount`), nichts wird gesendet.' },
  'app/(shell)/finance/reserves/carry-forward-dialog.tsx': { count: 1, reason: 'Unlesbar sperrt Speichern mit Grund (`reserveSaveBlocker`), nichts wird gesendet.' },
  'app/(shell)/finance/reserves/movement-dialog.tsx': { count: 1, reason: 'Unlesbar sperrt Speichern mit Grund (`reserveSaveBlocker`), nichts wird gesendet.' },
};

describe('Heuristik', () => {
  it('trifft den stillen Rückfall', () => {
    for (const hit of [
      'amountCents: parseAmount(amount) ?? 0,',
      "unit === 'cents' ? (parseAmount(amountText) ?? 0) : 1",
      "targetCents: targetText.trim() === '' ? null : parseAmount(targetText),",
      'const amountCents = override ? parseAmount(amount) : null;',
      'cents: parseAmount(x.trim()) ?? undefined',
    ])
      expect(silentAmountCount(hit), hit).toBe(1);
  });
  it('trifft nicht readAmount und keinen geprüften Wert', () => {
    for (const miss of ["const read = readAmount(text, { required: true });", 'const cents = parseAmount(text);', 'if (cents === null) return;', "readAmount(amount, { required: false })"])
      expect(silentAmountCount(miss), miss).toBe(0);
  });
});

describe('Beträge aus Masken nicht still zu null oder 0', () => {
  const files = sourceFiles(`${SRC}/app`).filter(isProductSource);
  const hits = lineHits(files, silentAmountCount);

  it('kein parseAmount mit stillem Rückfall; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits, ALLOWED).stale);
});
