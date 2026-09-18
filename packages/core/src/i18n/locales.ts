import type { Deps } from '../deps';
import { readSetting } from '../settings/service';

/** Kleinbuchstaben, optional mit Region: de, en, pt-br. */
export const LOCALE_CODE = /^[a-z]{2}(-[a-z]{2})?$/;

/** Die gepflegten Sprachen, erste ist Leitsprache. Nie leer. */
export function readLocales(deps: Deps): string[] {
  const value = readSetting<string[]>(deps, 'i18n.locales');
  return value.length > 0 ? value : ['de'];
}

export function defaultLocale(deps: Deps): string {
  return readLocales(deps)[0]!;
}
