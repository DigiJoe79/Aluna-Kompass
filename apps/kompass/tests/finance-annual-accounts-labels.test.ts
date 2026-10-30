import { ANNUAL_ACCOUNTS_PAPER_NAMES } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/** Bildabnahme 0.4.5 W-3: Der Hinweis nennt den Posten so, wie der Leser ihn im PDF findet. */
describe('Jahresrechnung: Namen der Posten am Bildschirm wie im PDF', () => {
  it('jeder Posten der Hinweise heißt am Bildschirm wie auf dem Papier', () => {
    const labels = messages.finance.reports.annualAccounts.labels as Record<string, string>;
    for (const [key, paper] of Object.entries(ANNUAL_ACCOUNTS_PAPER_NAMES)) expect([key, labels[key]]).toEqual([key, paper]);
  });
});
