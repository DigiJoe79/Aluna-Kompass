import { timeZoneOf, type Deps, type ServiceError } from '@kompass/core';
import type { ErrorTranslator } from '@kompass/mcp';
import { createTranslator } from 'next-intl';
import messages from '../../messages/de.json';
import { localizeError } from './error-text';

/**
 * Der MCP-Weg übersetzt serverseitig mit derselben Sprachdatei wie die Oberfläche (A6) — ohne Anfragekontext,
 * deshalb `createTranslator` statt `getTranslations`. Die Zeitzone ist die des Vereins, wie in `i18n/request.ts`.
 */
export function mcpErrorTranslator(deps: Pick<Deps, 'db' | 'registry'>): ErrorTranslator {
  return (error: ServiceError) => {
    const t = createTranslator({ locale: 'de', messages, timeZone: timeZoneOf(deps) }) as unknown as (key: string, values?: Record<string, string | number | Date>) => string;
    return localizeError(error, t);
  };
}
