import { timeZoneOf, type Deps } from '@kompass/core';
import { createTranslator } from 'next-intl';
import messages from '../../messages/de.json';
import { messageValues } from './error-text';

type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * K2: der Übersetzer für `Deps.labels` — Bezeichnungen von Haltern, Verweisen und Datensätzen, die die Module als
 * Schlüssel der Sprachdatei liefern. Serverseitig und ohne Anfragekontext wie `mcpErrorTranslator`, deshalb
 * `createTranslator`; ein Datum (`YYYY-MM-DD`) formatiert ICU in der Zeitzone des Vereins.
 */
export function labelTranslator(deps: Pick<Deps, 'db' | 'registry'>): NonNullable<Deps['labels']> {
  return (key, params) => {
    const t = createTranslator({ locale: 'de', messages, timeZone: timeZoneOf(deps) }) as unknown as Translate;
    return t(key, messageValues(params));
  };
}
