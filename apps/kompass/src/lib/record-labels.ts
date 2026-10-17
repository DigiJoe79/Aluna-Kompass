import { timeZoneOf, type Deps } from '@kompass/core';
import { createTranslator } from 'next-intl';
import messages from '../../messages/de.json';
import { messageValues } from './error-text';
import { nameOrEmpty } from './name-or-empty';

type Translate = ((key: string, values?: Record<string, string | number | Date>) => string) & { has: (key: string) => boolean };

/**
 * K2: der Übersetzer für `Deps.labels` — Bezeichnungen von Haltern, Verweisen und Datensätzen, die die Module als
 * Schlüssel der Sprachdatei liefern. Serverseitig und ohne Anfragekontext wie `mcpErrorTranslator`, deshalb
 * `createTranslator`; ein Datum (`YYYY-MM-DD`) schreibt `messageValues` als TT.MM.JJJJ.
 */
export function labelTranslator(deps: Pick<Deps, 'db' | 'registry'>): NonNullable<Deps['labels']> {
  return (key, params) => {
    const t = createTranslator({ locale: 'de', messages, timeZone: timeZoneOf(deps) }) as unknown as Translate;
    const values = messageValues(params);
    // Stufe 1, Auftrag 6: `contactRole` ist ein Rollenschlüssel — die Bezeichnung nennt den Namen (`contacts.roleNames`).
    if (typeof params.contactRole === 'string') values.role = nameOrEmpty(t.has(`contacts.roleNames.${params.contactRole}`) ? t(`contacts.roleNames.${params.contactRole}`) : null, params.contactRole);
    return t(key, values);
  };
}
