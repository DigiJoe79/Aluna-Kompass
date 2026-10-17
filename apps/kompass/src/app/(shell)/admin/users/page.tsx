import { isModuleEnabled, listRoles, listUsers, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { userContactLinkData } from '@/components/user-contact-link';
import { requireSession } from '@/lib/request-context';
import { CreateUserDialog } from './create-user-dialog';
import { UserTable } from './user-table';

export default async function UsersPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'users.manage')) return <Page width="full"><ForbiddenCard permission="users.manage" /></Page>;
  const t = await getTranslations('users');
  const users = await listUsers(deps, ctx);
  const roles = await listRoles(deps, ctx);
  if (!users.ok || !roles.ok) return <Page width="full"><ForbiddenCard permission="users.manage" /></Page>;
  const roleOptions = roles.value.map((r) => ({ id: r.id, name: r.name, grantable: r.grantable }));
  // Die Spalte „Kontakt“ gibt es nur, wenn das Modul an ist. Die Daten entstehen hier, auf dem Server; Verknüpfen
  // und Lösen bietet das Zeilenmenü der Tabelle (Runde 3, 155).
  const contactLinks = isModuleEnabled(deps, 'contacts')
    ? Object.fromEntries(await Promise.all(users.value.map(async (u) => [u.id, await userContactLinkData(deps, ctx, u.id)] as const)))
    : undefined;
  return (
    <Page width="full" header={<PageHeader title={t('title')} actions={<CreateUserDialog roles={roleOptions} />} />}>
      <UserTable users={users.value} roles={roleOptions} contactLinks={contactLinks} />
    </Page>
  );
}
