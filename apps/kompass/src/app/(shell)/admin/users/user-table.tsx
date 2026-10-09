'use client';

import type { ListedUser } from '@kompass/core';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { checkFilter, FilterBar } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUrlFilters } from '@/lib/use-url-filters';
import { cn } from '@/lib/utils';
import { resetStartPasswordAction, setUserActiveAction, setUserRolesAction } from './actions';
import { StartPasswordDialog } from './start-password-dialog';

export function UserTable({
  users,
  roles,
  contactCells,
}: {
  users: ListedUser[];
  roles: { id: string; name: string; grantable: boolean }[];
  /** Je Nutzer die fertige Zelle der Spalte „Kontakt“; ohne sie gibt es die Spalte nicht. */
  contactCells?: Record<string, ReactNode>;
}) {
  const t = useTranslations('users');
  const fmt = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startNavigation] = useTransition();
  // Gefiltert wird im Browser (wenige Nutzer); der Zustand steht trotzdem in der Adresse (Spec Filterleisten § 3),
  // damit Zurück und Neu laden ihn behalten.
  const [filters, setFilters] = useUrlFilters({ text: params.get('text') ?? '', active: params.get('active') === '1' ? '1' : '' });
  const query = filters.text;
  const onlyActive = filters.active === '1';
  const applyFilters = (patch: Partial<{ text: string; active: string }>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    const next = new URLSearchParams();
    if (merged.text.trim()) next.set('text', merged.text.trim());
    if (merged.active === '1') next.set('active', '1');
    const qs = next.toString();
    startNavigation(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };
  const [confirm, setConfirm] = useState<ListedUser | null>(null);
  const [reset, setReset] = useState<{ user: ListedUser; startPassword: string } | null>(null);
  const [editRoles, setEditRoles] = useState<ListedUser | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [pending, start] = useTransition();
  // Die Zeilenmenüs (Startpasswort, Aktivieren) haben keinen Platz für eine Meldung: Sie steht über der Tabelle. Die Rollen-Maske hat ihre eigene.
  const menuFb = useActionFeedback();
  const rolesFb = useActionFeedback();

  const rows = useMemo(
    () => users.filter((u) => (!onlyActive || u.isActive) && `${u.name} ${u.email}`.toLowerCase().includes(query.trim().toLowerCase())),
    [users, onlyActive, query],
  );
  const resetFilters = () => applyFilters({ text: '', active: '' });
  const tone = { active: 'success', firstLoginPending: 'warning', inactive: 'neutral' } as const;

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        search={<SearchField value={query} onChange={(text) => applyFilters({ text })} placeholder={t('filter.search')} />}
        searchActive={query.trim() ? { chip: query.trim(), onClear: () => applyFilters({ text: '' }) } : undefined}
        filters={[checkFilter({ key: 'active', label: t('filter.onlyActive'), value: onlyActive, onChange: (on) => applyFilters({ active: on ? '1' : '' }) })]}
        onApply={(values) => applyFilters(values)}
        // Befund 5: Die Zählzeile zählt Treffer.
        count={{ shown: rows.length, total: users.length, noun: { one: t('filter.nounOne'), other: t('filter.nounOther'), dative: t('filter.nounDative') } }}
        onReset={resetFilters}
      />
      <RefusalNotice action state={menuFb.state} />
      {rows.length === 0 ? (
        <EmptyState
          filtered={{
            noun: t('filter.emptyNoun'),
            onReset: resetFilters,
          }}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.email')}</TableHead>
                <TableHead>{t('columns.roles')}</TableHead>
                {contactCells ? <TableHead>{t('contactLink.column')}</TableHead> : null}
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.lastLogin')}</TableHead>
                <TableHead className="w-11" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u, i) => (
                <TableRow key={u.id}>
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
                  {contactCells ? <TableCell>{contactCells[u.id] ?? null}</TableCell> : null}
                  <TableCell>
                    <StatusBadge tone={tone[u.status]} dot>
                      {t(`status.${u.status}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-mono text-[13px] text-ink-2">
                    {u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : '—'}
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
                          disabled={!u.controllable}
                          onSelect={() => {
                            setSelectedRoles(u.roles.map((r) => r.id));
                            rolesFb.reset();
                            setEditRoles(u);
                          }}
                        >
                          {t('actions.roles')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!u.controllable}
                          onSelect={() =>
                            start(async () => {
                              const s = await menuFb.run(() => resetStartPasswordAction(u.id));
                              if (s.status === 'success') {
                                setReset({ user: u, startPassword: (s.data as { startPassword: string }).startPassword });
                              }
                            })
                          }
                        >
                          {t('actions.resetPassword')}
                        </DropdownMenuItem>
                        {u.isActive ? (
                          <DropdownMenuItem disabled={!u.controllable} onSelect={() => setConfirm(u)}>{t('actions.deactivate')}</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={!u.controllable}
                            onSelect={() =>
                              start(async () => {
                                await menuFb.run(() => setUserActiveAction(u.id, true));
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
      )}
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
          <DialogContent size="sm" className="bg-surface shadow-md">
            <DialogTitle>{t('roles.title', { name: editRoles.name })}</DialogTitle>
            <div className="flex flex-col gap-2">
              {roles.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-role-${r.id}`}
                    disabled={!r.grantable}
                    checked={selectedRoles.includes(r.id)}
                    onCheckedChange={(c) => setSelectedRoles((prev) => (c ? [...prev, r.id] : prev.filter((x) => x !== r.id)))}
                  />
                  <Label htmlFor={`edit-role-${r.id}`}>{r.name}</Label>
                </div>
              ))}
            </div>
            <FormActionBar
              placement="dialog"
              cancel={() => setEditRoles(null)}
              pending={pending}
              saveLabel={t('roles.save')}
              state={rolesFb.state}
              onSave={() =>
                start(async () => {
                  const s = await rolesFb.run(() => setUserRolesAction(editRoles.id, selectedRoles, editRoles.roles.map((r) => r.id)));
                  if (s.status === 'success') setEditRoles(null);
                })
              }
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
