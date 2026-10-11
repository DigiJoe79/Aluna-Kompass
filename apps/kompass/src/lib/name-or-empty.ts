import { nameOrEmpty as pureNameOrEmpty } from '@kompass/core/format';

/**
 * Namen statt Schlüssel (Stufe 1, Auftrag 6; MUSTER § Leerwert) für die App: fehlt der Name, `EMPTY` wie im Kern —
 * in der Entwicklung sagt zusätzlich eine Warnung, welcher Schlüssel ohne Namen blieb. Der Kern bleibt rein.
 */
export function nameOrEmpty(name: string | null | undefined, key: string): string {
  if (!name && process.env.NODE_ENV === 'development') console.warn('[kompass] Name fehlt, Schlüssel %s', key);
  return pureNameOrEmpty(name);
}
