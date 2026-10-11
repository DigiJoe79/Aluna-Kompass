import { nameOrEmpty } from './name-or-empty';

/**
 * Rollenschlüssel kommen aus den Manifesten der Module (`contactRoles`) und
 * sind Code — Englisch, wie Prinzip 7 es will. Was auf dem Bildschirm steht,
 * kommt aus `messages/de.json` unter `contacts.roleNames`. Fehlt ein
 * Schlüssel dort, steht „—“ (Stufe 1, Auftrag 6: Namen statt Schlüssel); `tests/contact-role-labels`
 * sorgt dafür, dass das nie passiert.
 */
export function roleLabel(t: { has(key: string): boolean; (key: string): string }, key: string): string {
  return nameOrEmpty(t.has(`roleNames.${key}`) ? t(`roleNames.${key}`) : null, key);
}
