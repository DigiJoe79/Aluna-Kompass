import type { Deps } from '../deps';
import type { DueItem, RetentionHold } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
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

/**
 * Wer dieses Objekt festhält. Befragt werden nur **aktive** Module: ein
 * ausgeschaltetes Modul schweigt (wie bei `mediaReferences`). Weil Schweigen
 * hier gefährlich ist — ein ausgeschaltetes Finanzmodul dürfte keinen Spender
 * freigeben —, muss jedes Modul mit diesem Haken in `dependsOn` des haltenden
 * Moduls stehen; `setModuleEnabled` verhindert das Abschalten dann von selbst.
 */
export function holdsFor(deps: Deps, entityType: string, id: string): RetentionHold[] {
  return enabledManifests(deps).flatMap((m) => [...(m.retentionHolds?.(deps, entityType, id) ?? [])]);
}

/**
 * Bis wann gehalten wird: das **Maximum** über alle Halter. Ein dauerhafter
 * Halter (`until: null`) gewinnt immer. Eine leere Liste liefert `null` im
 * Sinne von „kein Halter" — ob das „sofort fällig" oder „gar nicht geführt"
 * heißt, entscheidet der Aufrufer, nicht diese Funktion.
 */
export function dueUntil(holds: readonly RetentionHold[]): string | null {
  if (holds.length === 0) return null;
  if (holds.some((h) => h.until === null)) return null;
  return holds.reduce((max, h) => (h.until! > max ? h.until! : max), holds[0]!.until!);
}

/** Alles, was bei den aktiven Modulen zur Löschung fällig ist. */
export function collectRetentionDue(deps: Deps): DueItem[] {
  return enabledManifests(deps).flatMap((m) => [...(m.retentionDue?.(deps) ?? [])]);
}
