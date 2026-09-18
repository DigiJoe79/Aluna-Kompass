import { enabledManifests, type ContactRoleDefinition, type Deps } from '@kompass/core';

/**
 * Alle Kontaktrollen der aktiven Module, nach Schlüssel.
 *
 * Rollen kommen aus einer Registry und nicht aus freiem Text, weil an der Rolle
 * die Aufbewahrungsfrist hängt — und eine Frist, die an einem selbstgetippten
 * Wort hängt, ist keine.
 *
 * `createRegistry` im Core prüft nur auf Modulebene und kennt keine aktivierten
 * Module — zwei Module, die beide `donor` deklarieren, aber nie gemeinsam aktiv
 * sind, sind keine kaputte Installation. Die Prüfung auf doppelte Rollenschlüssel
 * gehört deshalb hierher: zwei *aktive* Module dürfen sich nicht denselben
 * Schlüssel teilen, sonst entscheidet die Reihenfolge der Module still darüber,
 * welche Aufbewahrungsklasse gilt — und eine lange Frist könnte klanglos durch
 * eine kurze ersetzt werden.
 */
export function contactRoleDefinitions(deps: Deps): Map<string, ContactRoleDefinition> {
  const byKey = new Map<string, ContactRoleDefinition>();
  const ownerByKey = new Map<string, string>();
  for (const manifest of enabledManifests(deps)) {
    for (const role of manifest.contactRoles ?? []) {
      const owner = ownerByKey.get(role.key);
      if (owner !== undefined) {
        throw new Error(`duplicate contact role key: ${role.key} (modules ${owner}, ${manifest.key})`);
      }
      ownerByKey.set(role.key, manifest.key);
      byKey.set(role.key, role);
    }
  }
  return byKey;
}
