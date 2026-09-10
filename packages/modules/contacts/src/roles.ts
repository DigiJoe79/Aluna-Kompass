import { enabledManifests, type ContactRoleDefinition, type Deps } from '@kompass/core';

/**
 * Alle Kontaktrollen der aktiven Module, nach Schlüssel.
 *
 * Rollen kommen aus einer Registry und nicht aus freiem Text, weil an der Rolle
 * die Aufbewahrungsfrist hängt — und eine Frist, die an einem selbstgetippten
 * Wort hängt, ist keine.
 */
export function contactRoleDefinitions(deps: Deps): Map<string, ContactRoleDefinition> {
  const byKey = new Map<string, ContactRoleDefinition>();
  for (const manifest of enabledManifests(deps)) {
    for (const role of manifest.contactRoles ?? []) byKey.set(role.key, role);
  }
  return byKey;
}
