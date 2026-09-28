import { getTranslations } from 'next-intl/server';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface PermissionMatrixActivity {
  key: string;
  permission: string;
}

export interface PermissionMatrixRole {
  id: string;
  name: string;
  permissions: string[];
  navigation: string[];
  holders: string[];
}

/** H8 — lesende Matrix: je Rolle ihre Tätigkeiten, wer sie trägt, „niemand“ als Wort und in Warnfarbe. */
export async function PermissionsPanel({ activities, roles }: { activities: PermissionMatrixActivity[]; roles: PermissionMatrixRole[] }) {
  const t = await getTranslations('finance.admin.permissions');
  const tPerm = await getTranslations('permissions.keys');
  const activityLabel = (permission: string) => (tPerm.has(`${permission}.label`) ? tPerm(`${permission}.label`) : permission);

  return (
    <section className="space-y-4" data-testid="permissions-panel">
      <h2 className="font-heading text-[18px] text-ink">{t('title')}</h2>
      <div className="space-y-4">
        {roles.map((role) => (
          <div key={role.id} className="overflow-hidden rounded-md border border-line" data-testid={`permission-role-${role.name}`}>
            <div className="bg-table-head px-4 py-2.5">
              <p className="font-semibold text-ink">{role.name}</p>
            </div>
            <Table>
              <TableHeader className="text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
                <TableRow className="h-8">
                  <TableHead className="px-4">{t('activity')}</TableHead>
                  <TableHead className="px-4">{t('granted')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.map((activity) => (
                  <TableRow key={activity.key} className="h-9 border-b border-line-2">
                    <TableCell className="px-4 text-ink-2">{activityLabel(activity.permission)}</TableCell>
                    <TableCell className="px-4">{role.permissions.includes(activity.permission) ? t('yes') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="space-y-1 border-t border-line px-4 py-2.5 text-[12px]">
              <p className="text-muted-ink">
                {t('navigation')}: {role.navigation.length > 0 ? role.navigation.map((key) => t(`navKeys.${key}`)).join(', ') : t('navigationNone')}
              </p>
              <p>
                <span className="text-muted-ink">{t('holders')}: </span>
                {role.holders.length > 0 ? <span className="text-ink">{role.holders.join(', ')}</span> : <span className="font-semibold text-warning">{t('nobody')}</span>}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
