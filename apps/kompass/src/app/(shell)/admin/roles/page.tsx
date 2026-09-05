import { listRoles, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { groupPermissions } from '@/lib/permission-groups';
import { requireSession } from '@/lib/request-context';
import { RoleEditor } from './role-editor';

export default async function RolesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'roles.manage')) return <ForbiddenCard permission="roles.manage" />;
  const t = await getTranslations('roles');
  const roles = await listRoles(deps, ctx);
  if (!roles.ok) return <ForbiddenCard permission="roles.manage" />;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <RoleEditor roles={roles.value} groups={groupPermissions(deps.registry.manifests)} allPermissionKeys={[...deps.registry.permissionKeys]} />
    </>
  );
}
