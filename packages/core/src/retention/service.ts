import type { Deps } from '../deps';
import { readSetting } from '../settings/service';
import type { RetentionClass } from './classes';

/**
 * Die konfigurierte Länge einer Klasse in Monaten. `permanent` liefert `null` —
 * es wird nie fällig, und `null` zwingt jeden Aufrufer, das zu behandeln.
 */
export function retentionMonths(deps: Deps, cls: RetentionClass): number | null {
  if (cls === 'permanent') return null;
  return readSetting<number>(deps, `retention.${cls}`);
}
