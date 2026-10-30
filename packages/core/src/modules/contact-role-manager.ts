import type { Deps } from '../deps';
import type { ContactRoleDefinition } from './manifest';
import { enabledManifests } from './service';

/**
 * Wer führt diese Kontaktrolle gerade? Das Modul aus `definition.managedBy`, sonst das **eingeschaltete** Modul, das
 * sie in `managesContactRoles` nennt (Gremien führt Vorstand und Schatzmeister, Spec Gremien § 3.4), sonst niemand
 * (`null`): Dann pflegt man sie von Hand.
 */
export function contactRoleManager(deps: Deps, definition: ContactRoleDefinition): string | null {
  if (definition.managedBy !== undefined) return definition.managedBy;
  return enabledManifests(deps).find((m) => m.managesContactRoles?.includes(definition.key))?.key ?? null;
}

/**
 * Wer führt **diese Zeile** der Rolle? Wie `contactRoleManager`, aber ein führendes Modul mit `ownsContactRoleRow`
 * führt nur die Zeilen, die es als seine meldet (Gremien: die eine Amtszeit trägt). Zeilen von vor dem Modul bleiben
 * von Hand beendbar (Befund V-1); neu anlegen bleibt gesperrt — dafür gilt `contactRoleManager`.
 */
export function contactRoleRowManager(deps: Deps, definition: ContactRoleDefinition, rowId: string): string | null {
  const manager = contactRoleManager(deps, definition);
  if (manager === null || definition.managedBy !== undefined) return manager;
  const owns = enabledManifests(deps).find((m) => m.key === manager)?.ownsContactRoleRow;
  return owns === undefined || owns(deps, rowId) ? manager : null;
}
