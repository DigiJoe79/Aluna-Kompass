import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/**
 * Die Meldungen der Läufe gehen an die Oberfläche und an Agenten (`mcpErrorTranslator`, dieselbe Sprachdatei).
 * Prüfung 2026-10-23: „ein Backup … Warten Sie, bis er fertig ist“ — und ein Agent sollte „die Seite neu laden“.
 */
const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as (key: string, values?: Record<string, string>) => string;

describe('Meldungen der Läufe', () => {
  it.each([
    ['create', 'Gerade läuft schon ein Backup.', 'Warten Sie, bis es fertig ist'],
    ['verify', 'Gerade läuft schon eine Prüfung.', 'Warten Sie, bis sie fertig ist'],
    ['restore', 'Gerade läuft schon ein Einspielen.', 'Warten Sie, bis es fertig ist'],
    ['other', 'Gerade läuft schon ein anderer Lauf.', 'Warten Sie, bis er fertig ist'],
  ])('jobRunning %s: Artikel und Pronomen passen', (kind, reason, remedy) => {
    expect(t('jobs.errors.jobRunning.reason', { kind })).toBe(reason);
    expect(t('jobs.errors.jobRunning.remedy', { kind })).toMatch(new RegExp(`^${remedy}`));
  });

  it('jobNotRunning spricht nicht von einer Seite — auch ein Agent liest es', () => {
    expect(t('jobs.errors.jobNotRunning.remedy')).not.toMatch(/Seite/);
  });
});
