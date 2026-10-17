import { hasPermission, listRoles, listUsers, requirePermission } from '@kompass/core';
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
  // „Trägt diese Rolle“ (Designer Frage 4, Joe): die aktiven Personen je Rolle — nur mit dem Recht, Nutzer zu sehen.
  const users = hasPermission(ctx, 'users.manage') ? await listUsers(deps, ctx) : null;
  const holders = users?.ok
    ? Object.fromEntries(roles.value.map((role) => [role.id, users.value.filter((u) => u.isActive && u.roles.some((r) => r.id === role.id)).map((u) => u.name)]))
    : undefined;
  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <RoleEditor roles={roles.value} groups={groupPermissions(deps.registry.manifests)} allPermissionKeys={[...deps.registry.permissionKeys]} grantablePermissionKeys={[...deps.registry.permissionKeys].filter((key) => ctx.permissions.has(key))} holders={holders} />
    </Page>
  );
}
