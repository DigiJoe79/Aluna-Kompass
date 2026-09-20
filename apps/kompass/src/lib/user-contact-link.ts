/**
 * Was die Nutzerverwaltung an der Spalte „Kontakt“ anbietet. Eine reine
 * Entscheidung aus einfachen Daten — die Knöpfe sind nur Höflichkeit: Ob es
 * geht, entscheidet der Dienst und lehnt sonst ab.
 */
export interface LinkControls {
  canLink: boolean;
  canUnlink: boolean;
  reason: 'needsContactsView' | 'ownOnce' | 'ownNeedsSecondPerson' | null;
}

export function linkControls(s: { moduleOn: boolean; canManageUsers: boolean; canViewContacts: boolean; isSelf: boolean; linked: boolean; hadLinkBefore: boolean }): LinkControls | null {
  if (!s.moduleOn || !s.canManageUsers) return null;
  if (s.isSelf && s.hadLinkBefore) return { canLink: false, canUnlink: false, reason: 'ownNeedsSecondPerson' };
  if (s.linked) return { canLink: false, canUnlink: true, reason: null };
  if (!s.canViewContacts) return { canLink: false, canUnlink: false, reason: 'needsContactsView' };
  return { canLink: true, canUnlink: false, reason: s.isSelf ? 'ownOnce' : null };
}
