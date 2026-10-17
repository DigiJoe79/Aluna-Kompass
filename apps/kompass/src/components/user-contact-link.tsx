import { hasPermission, isModuleEnabled, type CallContext, type Deps } from '@kompass/core';
import { getUserLink, hasLinkHistoryInternal } from '@kompass/module-contacts';
import { linkControls, type UserContactLinkData } from '@/lib/user-contact-link';

/**
 * Die Spalte „Kontakt“ der Nutzerverwaltung, als Daten für die Tabelle. Lebt in der App-Schicht, weil die
 * Nutzerverwaltung dem Kern gehört und die Verknüpfung dem Modul Kontakte — wie `RelatedDocuments` von der anderen
 * Seite. Ist das Modul aus oder fehlt das Recht, gibt es nichts. „Verknüpfen“ und „Lösen“ stehen im Zeilenmenü der
 * Tabelle (Runde 3, 155), der Dialog in `user-contact-link-form.tsx`.
 */
export async function userContactLinkData(deps: Deps, ctx: CallContext, userId: string): Promise<UserContactLinkData | null> {
  const moduleOn = isModuleEnabled(deps, 'contacts');
  const canManageUsers = hasPermission(ctx, 'users.manage');
  if (!moduleOn || !canManageUsers) return null;

  const canViewContacts = hasPermission(ctx, 'contacts.view');
  const res = await getUserLink(deps, ctx, { userId });
  const link = res.ok ? res.value.link : null;
  const controls = linkControls({
    moduleOn,
    canManageUsers,
    canViewContacts,
    isSelf: ctx.userId === userId,
    linked: link !== null,
    hadLinkBefore: hasLinkHistoryInternal(deps.db, userId),
  });
  if (!controls) return null;

  // Den Namen sieht nur, wer Kontakte sehen darf; sonst steht dort „verknüpft“.
  const linkedName = link && canViewContacts && res.ok ? res.value.contactName : null;
  return { linked: link !== null, linkedName, linkedHref: link && canViewContacts ? `/contacts/${link.contactId}` : null, controls };
}
