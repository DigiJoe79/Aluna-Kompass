import { describe, expect, it } from 'vitest';
import { createTestDeps } from '@kompass/core/testing';
import { readLocales, defaultLocale, LOCALE_CODE } from '../src/i18n/locales';
import { setSetting } from '../src/settings/service';
import { ctxWith, insertUser } from '@kompass/core/testing';

describe('locales setting', () => {
  it('starts with a single German locale', () => {
    const deps = createTestDeps();
    expect(readLocales(deps)).toEqual(['de']);
    expect(defaultLocale(deps)).toBe('de');
  });

  it('reads what was configured, first entry leading', async () => {
    const deps = createTestDeps();
    insertUser(deps, { id: 'USER-TEST' });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['en', 'de', 'fr'] });
    expect(readLocales(deps)).toEqual(['en', 'de', 'fr']);
    expect(defaultLocale(deps)).toBe('en');
  });

  it('accepts language and region codes, rejects the rest', () => {
    for (const good of ['de', 'en', 'pt-br']) expect(LOCALE_CODE.test(good)).toBe(true);
    for (const bad of ['DE', 'deu', '', 'de_DE', 'de-DE']) expect(LOCALE_CODE.test(bad)).toBe(false);
  });
});
