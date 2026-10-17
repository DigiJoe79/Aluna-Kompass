'use client';

import type { ListedUser } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { checkFilter, FilterBar } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { isNormalInList, StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUrlFilters } from '@/lib/use-url-filters';
import { resetStartPasswordAction, setUserActiveAction, setUserRolesAction, unlinkUserAction } from './actions';
import { UserContactLinkDialog } from '@/components/user-contact-link-form';
import type { UserContactLinkData } from '@/lib/user-contact-link';
import { StartPasswordDialog } from './start-password-dialog';
import { Empty } from '@/components/empty-value';
import { RowMenu } from '@/components/row-menu';

export function UserTable({
  users,
  roles,
  contactLinks,
}: {
  users: ListedUser[];
  roles: { id: string; name: string; grantable: boolean }[];
  /** Je Nutzer die Verknüpfung mit einem Kontakt (`null`: nichts anzubieten); ohne sie gibt es die Spalte nicht. */
  contactLinks?: Record<string, UserContactLinkData | null>;
}) {
  const t = useTranslations('users');
  const tLink = useTranslations('users.contactLink');
  const [linking, setLinking] = useState<{ userId: string; reason: UserContactLinkData['controls']['reason'] } | null>(null);
  const tMuted = useTranslations('common.muted');
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

  // Runde 3, 155: Verknüpfen und Lösen im Zeilenmenü; ein fachlich gesperrter Eintrag nennt seinen Grund.
  const contactMenuItems = (u: ListedUser) => {
    const link = contactLinks?.[u.id];
    if (!link) return [];
    const reason = link.controls.reason ? tLink(link.controls.reason) : undefined;
    if (link.linked) {
      return [
        {
          key: 'unlink',
          label: tLink('menuUnlink'),
          disabledReason: link.controls.canUnlink ? undefined : reason,
          onSelect: () =>
            start(async () => {
              const res = await menuFb.run(() => unlinkUserAction(u.id));
              if (res.status === 'success' && !res.message) toast.success(tLink('ended'));
            }),
        },
      ];
    }
    return [
      {
        key: 'link',
        label: tLink('menuLink'),
        disabledReason: link.controls.canLink ? undefined : reason,
        onSelect: () => setLinking({ userId: u.id, reason: link.controls.reason }),
      },
    ];
  };

  const rows = useMemo(
    () => users.filter((u) => (!onlyActive || u.isActive) && `${u.name} ${u.email}`.toLowerCase().includes(query.trim().toLowerCase())),
    [users, onlyActive, query],
  );
  const resetFilters = () => applyFilters({ text: '', active: '' });

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
                <TableHead col="title">{t('columns.name')}</TableHead>
                <TableHead col="meta">{t('columns.email')}</TableHead>
                <TableHead col="meta">{t('columns.roles')}</TableHead>
                {contactLinks ? <TableHead col="meta">{t('contactLink.column')}</TableHead> : null}
                <TableHead col="status">{t('columns.status')}</TableHead>
                {/* Mit Kontaktspalte ist sie der dritte meta-Platz (der Kontakt bleibt am Telefon sichtbar), sonst die letzte Anmeldung. */}
                <TableHead col={contactLinks ? undefined : 'meta'}>{t('columns.lastLogin')}</TableHead>
                <TableHead col="actions" className="w-11"><span className="sr-only">{t('actions.menu')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u, i) => (
                // Deaktiviert ist die gedämpfte Zeile mit Marke hinter dem Namen (Joe 11.8); die Statusspalte nennt nur noch
                // den Erstlogin, und ohne ihn fällt sie weg.
                <TableRow key={u.id} muted={u.isActive ? undefined : tMuted('deactivated')}>
                  <TableCell col="title" className="font-semibold">{u.name}</TableCell>
                  <TableCell col="meta" className="text-ink-2">{u.email}</TableCell>
                  <TableCell col="meta">
                    <div className="flex flex-wrap gap-1.5">
                      {u.roles.map((r) => (
                        <StatusBadge key={r.id} tone={statusTone('role', 'current')}>
                          {r.name}
                        </StatusBadge>
                      ))}
                    </div>
                  </TableCell>
                  {contactLinks ? (
                    <TableCell col="meta">
                      {contactLinks[u.id]?.linked ? (
                        contactLinks[u.id]!.linkedName && contactLinks[u.id]!.linkedHref ? (
                          <Link href={contactLinks[u.id]!.linkedHref!} className="text-link underline-offset-2 hover:underline">
                            {contactLinks[u.id]!.linkedName}
                          </Link>
                        ) : (
                          <span className="text-ink-2">{tLink('linkedWithoutView')}</span>
                        )
                      ) : (
                        <Empty />
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell col="status">
                    {isNormalInList('user', u.status) || !u.isActive ? null : (
                      <StatusBadge tone={statusTone('user', u.status)} dot>
                        {t(`status.${u.status}`)}
                      </StatusBadge>
                    )}
                  </TableCell>
                  <TableCell col={contactLinks ? undefined : 'meta'} className="tabular-nums text-meta text-ink-2">
                    {u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : <Empty />}
                  </TableCell>
                  <TableCell col="actions">
                    <RowMenu
                      name={u.name}
                      items={[
                        {
                          key: 'roles',
                          label: t('actions.roles'),
                          disabledReason: u.controllable ? undefined : t('actions.notControllable'),
                          onSelect: () => {
                            setSelectedRoles(u.roles.map((r) => r.id));
                            rolesFb.reset();
                            setEditRoles(u);
                          },
                        },
                        {
                          key: 'resetPassword',
                          label: t('actions.resetPassword'),
                          disabledReason: u.controllable ? undefined : t('actions.notControllable'),
                          onSelect: () =>
                            start(async () => {
                              const s = await menuFb.run(() => resetStartPasswordAction(u.id));
                              if (s.status === 'success') {
                                setReset({ user: u, startPassword: (s.data as { startPassword: string }).startPassword });
                              }
                            }),
                        },
                        {
                          key: 'active',
                          label: u.isActive ? t('actions.deactivate') : t('actions.activate'),
                          disabledReason: u.controllable ? undefined : t('actions.notControllable'),
                          onSelect: () => (u.isActive ? setConfirm(u) : start(async () => void (await menuFb.run(() => setUserActiveAction(u.id, true))))),
                        },
                        ...contactMenuItems(u),
                      ]}
                    />
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
          title={t('deactivate.title', { name: confirm.name })}
          description={t('deactivate.text', { name: confirm.name })}
          confirmLabel={t('actions.deactivate')}
          destructive
          action={() => setUserActiveAction(confirm.id, false)}
        />
      ) : null}
      {linking ? (
        <UserContactLinkDialog userId={linking.userId} reason={linking.reason} open onOpenChange={(o) => (o ? null : setLinking(null))} />
      ) : null}
      {reset ? (
        <StartPasswordDialog
          kind="reset"
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
