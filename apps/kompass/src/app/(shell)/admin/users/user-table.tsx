'use client';

import type { UserSummary } from '@kompass/core';
import { MoreHorizontal } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { resetStartPasswordAction, setUserActiveAction, setUserRolesAction } from './actions';
import { StartPasswordDialog } from './start-password-dialog';

export function UserTable({ users, roles }: { users: UserSummary[]; roles: { id: string; name: string }[] }) {
  const t = useTranslations('users');
  const format = useFormatter();
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [confirm, setConfirm] = useState<UserSummary | null>(null);
  const [reset, setReset] = useState<{ user: UserSummary; startPassword: string } | null>(null);
  const [editRoles, setEditRoles] = useState<UserSummary | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const rows = useMemo(
    () => users.filter((u) => (showInactive || u.isActive) && `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase())),
    [users, showInactive, query],
  );
  const inactive = users.filter((u) => !u.isActive).length;
  const tone = { active: 'success', firstLoginPending: 'warning', inactive: 'neutral' } as const;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Input
          aria-label={t('filter.search')}
          placeholder={t('filter.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-[260px]"
        />
        <div className="flex items-center gap-2">
          <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
          <Label htmlFor="show-inactive">{t('filter.showInactive')}</Label>
        </div>
        <span className="ml-auto text-[13px] text-muted-ink">{t('filter.count', { count: users.length, inactive })}</span>
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <Table>
          <TableHeader className="bg-table-head">
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.email')}</TableHead>
              <TableHead>{t('columns.roles')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.lastLogin')}</TableHead>
              <TableHead className="w-11" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u, i) => (
              <TableRow key={u.id} className={cn('h-[var(--row-h)] hover:bg-row-hover', i % 2 === 1 && 'bg-zebra')}>
                <TableCell className={cn('font-semibold', !u.isActive && 'text-disabled-ink')}>{u.name}</TableCell>
                <TableCell className={cn('text-ink-2', !u.isActive && 'text-disabled-ink')}>{u.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {u.roles.map((r) => (
                      <StatusBadge key={r.id} tone="brand">
                        {r.name}
                      </StatusBadge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge tone={tone[u.status]} dot>
                    {t(`status.${u.status}`)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="font-mono text-[13px] text-ink-2">
                  {u.lastLoginAt ? format.dateTime(new Date(u.lastLoginAt), { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon" aria-label={t('actions.menu')}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="bg-surface shadow-md">
                      <DropdownMenuItem
                        onSelect={() => {
                          setSelectedRoles(u.roles.map((r) => r.id));
                          setEditRoles(u);
                        }}
                      >
                        {t('actions.roles')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          start(async () => {
                            const s = await resetStartPasswordAction(u.id);
                            if (s.status === 'success') {
                              setReset({ user: u, startPassword: (s.data as { startPassword: string }).startPassword });
                            } else if (s.status === 'error') {
                              toast.error(s.message);
                            }
                          })
                        }
                      >
                        {t('actions.resetPassword')}
                      </DropdownMenuItem>
                      {u.isActive ? (
                        <DropdownMenuItem onSelect={() => setConfirm(u)}>{t('actions.deactivate')}</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() =>
                            start(async () => {
                              const s = await setUserActiveAction(u.id, true);
                              if (s.status === 'error') toast.error(s.message);
                            })
                          }
                        >
                          {t('actions.activate')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setConfirm(null);
          }}
          title={t('deactivate.title')}
          description={t('deactivate.text', { name: confirm.name })}
          confirmLabel={t('actions.deactivate')}
          destructive
          action={() => setUserActiveAction(confirm.id, false)}
        />
      ) : null}
      {reset ? (
        <StartPasswordDialog
          open
          onClose={() => setReset(null)}
          name={reset.user.name}
          email={reset.user.email}
          startPassword={reset.startPassword}
        />
      ) : null}
      {editRoles ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setEditRoles(null);
          }}
        >
          <DialogContent className="bg-surface shadow-md">
            <DialogTitle className="font-heading text-[19px]">{t('roles.title', { name: editRoles.name })}</DialogTitle>
            <div className="flex flex-col gap-2">
              {roles.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-role-${r.id}`}
                    checked={selectedRoles.includes(r.id)}
                    onCheckedChange={(c) => setSelectedRoles((prev) => (c ? [...prev, r.id] : prev.filter((x) => x !== r.id)))}
                  />
                  <Label htmlFor={`edit-role-${r.id}`}>{r.name}</Label>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditRoles(null)}>
                {t('roles.cancel')}
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const s = await setUserRolesAction(editRoles.id, selectedRoles, editRoles.roles.map((r) => r.id));
                    if (s.status === 'error') toast.error(s.message);
                    else toast.success(s.status === 'success' ? s.message ?? '' : '');
                    setEditRoles(null);
                  })
                }
              >
                {t('roles.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
