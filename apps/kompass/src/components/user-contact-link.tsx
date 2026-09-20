import { hasPermission, isModuleEnabled, type CallContext, type Deps } from '@kompass/core';
import { getUserLink, hasLinkHistoryInternal } from '@kompass/module-contacts';
import { linkControls } from '@/lib/user-contact-link';
import { UserContactLinkForm } from './user-contact-link-form';

/**
 * Die Spalte „Kontakt“ der Nutzerverwaltung. Lebt in der App-Schicht, weil die
 * Nutzerverwaltung dem Kern gehört und die Verknüpfung dem Modul Kontakte — wie
 * `RelatedDocuments` von der anderen Seite. Ist das Modul aus oder fehlt das
 * Recht, gibt es die Zelle nicht.
 */
export async function UserContactLink({ deps, ctx, userId }: { deps: Deps; ctx: CallContext; userId: string }) {
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
  return <UserContactLinkForm userId={userId} linked={link !== null} linkedName={linkedName} linkedHref={link && canViewContacts ? `/contacts/${link.contactId}` : null} controls={controls} />;
}
