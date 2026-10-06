import { listRoles, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { groupPermissions } from '@/lib/permission-groups';
import { requireSession } from '@/lib/request-context';
import { RoleEditor } from './role-editor';

export default async function RolesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'roles.manage')) return <Page width="standard"><ForbiddenCard permission="roles.manage" /></Page>;
  const t = await getTranslations('roles');
  const roles = await listRoles(deps, ctx);
  if (!roles.ok) return <Page width="standard"><ForbiddenCard permission="roles.manage" /></Page>;
  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <RoleEditor roles={roles.value} groups={groupPermissions(deps.registry.manifests)} allPermissionKeys={[...deps.registry.permissionKeys]} grantablePermissionKeys={[...deps.registry.permissionKeys].filter((key) => ctx.permissions.has(key))} />
    </Page>
  );
}
