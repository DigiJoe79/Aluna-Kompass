import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readHandbookPage } from '@kompass/core';
import { financeModule } from '@kompass/module-finance';
import { helpDocFor, helpEntries } from '@/lib/help';

/**
 * F4b Task 7: Das Handbuch rät zuerst zu CAMT, erklärt den Formatwechsel und
 * was er kostet, und dass eine Gebühr ein eigener Kontoumsatz wird.
 */
const env = { handbookDir: path.resolve(import.meta.dirname, '../../../docs/handbuch') };

describe('Handbuch: CSV-Format einrichten', () => {
  it('rät zuerst zu CAMT und erklärt Formatwechsel, Gebühren und den Kontostand laut Bank', () => {
    const page = readHandbookPage(env, 'finanzen/csv-format-einrichten');
    expect(page).not.toBeNull();
    const body = page!.body;
    expect(body.indexOf('CAMT')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('CAMT')).toBeLessThan(body.indexOf('## Die fünf Schritte'));
    expect(body).toMatch(/## Formatwechsel/);
    expect(body).toMatch(/Gebühr/);
    expect(body).toMatch(/Kontostand laut Bank/);
  });

  it('die Seite „Kontoauszug laden“ verweist auf die CSV-Seite', () => {
    expect(readHandbookPage(env, 'finanzen/kontoauszug-laden')!.body).toMatch(/\(csv-format-einrichten\.md\)/);
  });

  it('der Hilfe-Knopf im Assistenten öffnet diese Seite, auf „Hochgeladene Auszüge“ die allgemeine', () => {
    const entries = helpEntries([financeModule], new Set(['finance']));
    expect(helpDocFor(entries, '/finance/imports/format')).toBe('finanzen/csv-format-einrichten');
    expect(helpDocFor(entries, '/finance/imports')).toBe('finanzen/kontoauszug-laden');
  });
});
