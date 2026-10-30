import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, read, relative, sourceFiles, staleKeys } from './source';

/**
 * Texte einer Kachel gehören der Kachel: `dashboard-messages.test.ts` prüft nur die Schlüssel, die sie in `messageKeys`
 * deklariert. Eine Seite, die ihren Namensraum mit eigenen, zur Laufzeit gebildeten Schlüsseln liest, ist dort unsichtbar
 * und bricht mit MISSING_MESSAGE ab (0.5.0: Gremien-Übersicht, nur mit echten Daten ab dem 1. Oktober). Wer es trotzdem
 * tut, steht hier und sagt, warum die Kachel alle Schlüssel deklariert.
 */
export const ALLOWED: Allowlist = {
  'app/(shell)/governance/page.tsx': 'Liest jede Fristart; die Kachel deklariert `[...GOVERNANCE_DEADLINE_KINDS]`, auch was sie selbst ausfiltert.',
};

export const tileNamespaceUsed = (source: string): boolean => /(?:getTranslations|useTranslations)\(\s*['"`]dashboard\.tiles\./.test(source);

const users = (): string[] => sourceFiles().filter((file) => tileNamespaceUsed(read(file))).map(relative);

describe('Kachel-Texte bleiben bei den Kacheln', () => {
  it('erkennt den Zugriff', () => {
    expect(tileNamespaceUsed("await getTranslations('dashboard.tiles.finance.due.messages')")).toBe(true);
    expect(tileNamespaceUsed("useTranslations('dashboard.tiles.x.y')")).toBe(true);
    expect(tileNamespaceUsed("getTranslations('dashboard')")).toBe(false);
  });

  it('nur die begründeten Seiten lesen den Namensraum einer Kachel', () => {
    expect(users().filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => staleKeys(ALLOWED, users()));
});
