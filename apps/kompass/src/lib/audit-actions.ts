/**
 * Der Klartext einer Aktion des Protokolls (`animals.update` → „Tier geändert“) steht unter `audit.actions` in der
 * Sprachdatei; Punkte werden dort zu Unterstrichen, weil next-intl Punkte als Verschachtelung liest. Fehlt ein
 * Eintrag (eine neue Aktion, ein Modul ohne Klartext), bleibt der Schlüssel stehen — lesbar für den, der sucht.
 * Ein Katalog über die Manifeste der Module (Backlog 33) würde diese Tabelle ablösen.
 */
export const auditActionKey = (action: string): string => `actions.${action.replaceAll('.', '_')}`;

export function auditActionLabel(t: { has: (key: string) => boolean; (key: string): string }, action: string): string {
  const key = auditActionKey(action);
  return t.has(key) ? t(key) : action;
}
