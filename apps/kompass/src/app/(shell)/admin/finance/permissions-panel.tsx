import { getTranslations } from 'next-intl/server';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { nameOrEmpty } from '@/lib/name-or-empty';

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

/**
 * „Wer darf was“ (Designer Frage 4, 173): eine Liste je Tätigkeit, keine Matrix und keine Tabelle je Rolle — eine Zeile
 * je Tätigkeit mit der Unterzeile „erteilt an …“; ist keine Rolle erteilt, „an keine Rolle erteilt“ in Ocker. Wer eine
 * Rolle trägt, steht im Rolleneditor. Der Dienst `getPermissionMatrix` liefert weiter Navigation und Träger (MCP).
 */
export async function PermissionsPanel({ activities, roles }: { activities: PermissionMatrixActivity[]; roles: PermissionMatrixRole[] }) {
  const t = await getTranslations('finance.admin.permissions');
  const tPerm = await getTranslations('permissions.keys');
  const activityLabel = (permission: string) => nameOrEmpty(tPerm.has(`${permission}.label`) ? tPerm(`${permission}.label`) : null, permission);

  return (
    <section className="space-y-4" data-testid="permissions-panel">
      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('activity')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((activity) => {
              const granted = roles.filter((role) => role.permissions.includes(activity.permission)).map((role) => role.name);
              return (
                <TableRow key={activity.key} data-testid="permission-activity">
                  <TableCell col="title" className="whitespace-normal">
                    <span className="block text-ink">{activityLabel(activity.permission)}</span>
                    {granted.length > 0 ? (
                      <span className="block text-hint text-muted-ink">{t('grantedTo', { roles: granted.join(', ') })}</span>
                    ) : (
                      <span className="block text-hint font-semibold text-warning">{t('grantedToNone')}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
