import { listRoles, listUsers, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
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
  const roleOptions = roles.value.map((r) => ({ id: r.id, name: r.name }));
  return (
    <>
      <PageHeader title={t('title')} actions={<CreateUserDialog roles={roleOptions} />} />
      <UserTable users={users.value} roles={roleOptions} />
    </>
  );
}
