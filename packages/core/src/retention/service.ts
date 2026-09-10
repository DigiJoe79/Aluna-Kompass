import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { DueItem, RetentionHold } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { requirePermission } from '../permissions/check';
import { ok, type Result } from '../result';
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

const FULL_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Wer dieses Objekt festhält. Befragt werden nur **aktive** Module: ein
 * ausgeschaltetes Modul schweigt (wie bei `mediaReferences`). Weil Schweigen
 * hier gefährlich ist — ein ausgeschaltetes Finanzmodul dürfte keinen Spender
 * freigeben —, muss jedes Modul mit diesem Haken in `dependsOn` des haltenden
 * Moduls stehen; `setModuleEnabled` verhindert das Abschalten dann von selbst.
 *
 * Diese Funktion ist die Grenze, an der ein von fremdem Code geschriebener
 * `until`-Wert zum ersten Mal ankommt: er wird hier gegen das volle
 * `YYYY-MM-DD`-Format geprüft und bei Verstoß geworfen — nie still verworfen,
 * denn ein verworfener Halter ist ein Halter, der den Datensatz nicht mehr
 * schützt, genau das Gegenteil dessen, wofür diese Funktion existiert.
 *
 * Wirft ein Modul-Haken selbst, wird das **durchgereicht**, nicht verschluckt:
 * ein defekter Haken darf niemals als „hält nichts" gelesen werden — sonst
 * würde ein kaputtes Finanzmodul jeden Spender zur Löschung freigeben.
 */
export function holdsFor(deps: Deps, entityType: string, id: string): RetentionHold[] {
  return enabledManifests(deps).flatMap((m) =>
    [...(m.retentionHolds?.(deps, entityType, id) ?? [])].map((hold) => {
      if (hold.until !== null && !FULL_ISO_DATE.test(hold.until)) {
        throw new Error(`holdsFor: module "${m.key}" returned a malformed until for hold "${hold.label}": ${JSON.stringify(hold.until)}`);
      }
      return hold;
    }),
  );
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

/**
 * Alles, was bei den aktiven Modulen zur Löschung fällig ist. Wirft ein
 * Modul-Haken, reißt das den ganzen Fristenbildschirm mit — anders als bei
 * `holdsFor` ist das hier hinnehmbar (ein leerer statt ein falscher Bildschirm),
 * aber bewusst so entschieden und nicht nur ein Nebeneffekt von `flatMap`.
 */
export function collectRetentionDue(deps: Deps): DueItem[] {
  return enabledManifests(deps).flatMap((m) => [...(m.retentionDue?.(deps) ?? [])]);
}

/** Alles, was zur Löschung ansteht — über alle aktiven Module hinweg. */
export async function listRetentionDue(deps: Deps, ctx: CallContext): Promise<Result<DueItem[]>> {
  const denied = requirePermission(ctx, 'retention.view');
  if (denied) return denied;
  return ok(collectRetentionDue(deps));
}
