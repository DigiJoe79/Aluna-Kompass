import { isModuleEnabled, listRoles, listUsers, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { UserContactLink } from '@/components/user-contact-link';
import { requireSession } from '@/lib/request-context';
import { CreateUserDialog } from './create-user-dialog';
import { UserTable } from './user-table';

export default async function UsersPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'users.manage')) return <ForbiddenCard permission="users.manage" />;
  const t = await getTranslations('users');
  const users = await listUsers(deps, ctx);
  const roles = await listRoles(deps, ctx);
  if (!users.ok || !roles.ok) return <ForbiddenCard permission="users.manage" />;
  const roleOptions = roles.value.map((r) => ({ id: r.id, name: r.name, grantable: r.grantable }));
  // Die Spalte „Kontakt“ gibt es nur, wenn das Modul an ist. Die Zellen entstehen
  // hier, auf dem Server, und reisen als fertige Elemente in die Tabelle.
  const contactCells = isModuleEnabled(deps, 'contacts')
    ? Object.fromEntries(users.value.map((u) => [u.id, <UserContactLink key={u.id} deps={deps} ctx={ctx} userId={u.id} />]))
    : undefined;
  return (
    <>
      <PageHeader title={t('title')} actions={<CreateUserDialog roles={roleOptions} />} />
      <UserTable users={users.value} roles={roleOptions} contactCells={contactCells} />
    </>
  );
}
