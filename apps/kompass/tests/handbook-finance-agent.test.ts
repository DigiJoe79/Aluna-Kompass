import path from 'node:path';
import { readHandbookPage } from '@kompass/core';
import { describe, expect, it } from 'vitest';

/**
 * Entschieden (F4, 21.09.2026), Punkt 3: Ein Agent darf Kontoauszüge laden,
 * nie festschreiben — unter der Bedingung, dass das Handbuch es ausdrücklich
 * sagt. Dieser Test findet den Absatz über seine Überschrift und verlangt die
 * beiden Wörter, die den Unterschied zwischen Cloud- und lokalem Modell
 * ausmachen.
 */
const env = { handbookDir: path.resolve(import.meta.dirname, '../../../docs/handbuch') };

describe('Handbuch: Kontoauszug laden', () => {
  it('tells the association what it means when an agent loads bank statements', () => {
    const page = readHandbookPage(env, 'finanzen/kontoauszug-laden');
    expect(page).not.toBeNull();
    expect(page!.body).toMatch(/## Wenn ein KI-Agent Auszüge lädt/);
    expect(page!.body).toMatch(/Auftragsverarbeitung/);
    expect(page!.body).toMatch(/Verarbeitungsverzeichnis/);
  });
});
