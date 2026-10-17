import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

const t = createTranslator({ locale: 'de', messages, namespace: 'site.admin' });

/** Runde 3, 176/177: Zeilen, die ohne Zusammenhang unklar waren. */
describe('Einstellungen Webseite', () => {
  it('nennt die Testumgebung ausgeschrieben (176)', () => {
    expect(t('connection.staging')).toBe('Testumgebung');
  });
  it('sagt, was gezählt ist (177)', () => {
    expect(t('cache.images', { count: 10, size: '0,8' })).toBe('10 Dateien, 0,8 MB');
    expect(t('cache.images', { count: 1, size: '0,1' })).toBe('1 Datei, 0,1 MB');
  });
});
