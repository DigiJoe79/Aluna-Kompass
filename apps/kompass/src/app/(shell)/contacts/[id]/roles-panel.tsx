'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormField } from '@/components/forms/form-field';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { addContactRoleAction, endContactRoleAction } from '../actions';
import { Select } from '@/components/ui/select';

export function RolesPanel({
  contactId,
  roles,
  roleDefinitions,
  canManage,
}: {
  contactId: string;
  roles: { id: string; role: string; since: string; until: string | null }[];
  roleDefinitions: { key: string; retention: string }[];
  canManage: boolean;
}) {
  const t = useTranslations('contacts');
  const c = useTranslations('common');

  const [addOpen, setAddOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState(roleDefinitions[0]?.key ?? '');
  const [since, setSince] = useState(new Date().toISOString().slice(0, 10));
  const [addPending, startAdd] = useTransition();

  const [endingRoleId, setEndingRoleId] = useState<string | null>(null);
  const [until, setUntil] = useState(new Date().toISOString().slice(0, 10));
  const [endPending, startEnd] = useTransition();

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole || !since) return;
    startAdd(async () => {
      await addContactRoleAction(contactId, selectedRole, since);
      setAddOpen(false);
    });
  };

  const handleEndSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!endingRoleId || !until) return;
    startEnd(async () => {
      await endContactRoleAction(contactId, endingRoleId, until);
      setEndingRoleId(null);
    });
  };

  return (
    <section className="rounded-md border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">{t('roles.title')}</h2>
        {canManage ? (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger
              render={
                <Button size="sm" variant="outline">
                  <Plus className="size-3.5" aria-hidden />
                  {t('roles.add')}
                </Button>
              }
            />
            <DialogContent className="w-full sm:max-w-[440px] bg-surface p-0 shadow-md">
              <form onSubmit={handleAddSubmit}>
                <div className="p-6">
                  <DialogTitle className="font-heading text-[17px]">{t('roles.add')}</DialogTitle>
                  <DialogDescription className="text-[13px] text-muted-ink">
                    {t('roles.title')}
                  </DialogDescription>

                  <div className="mt-4 space-y-3.5">
                    <FormField id="role" label={t('roles.field')}>
                      <Select
                        id="role"
                        name="role"
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        required
                      >
                        {roleDefinitions.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.key}
                          </option>
                        ))}
                      </Select>
                    </FormField>

                    <FormField id="since" label={t('roles.since')}>
                      <Input
                        id="since"
                        name="since"
                        type="date"
                        value={since}
                        onChange={(e) => setSince(e.target.value)}
                        required
                      />
                    </FormField>
                  </div>
                </div>

                <DialogFooter className="items-center border-t border-line bg-surface-2 px-6 py-3">
                  <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
                    {c('cancel')}
                  </Button>
                  <Button type="submit" disabled={addPending}>
                    {t('roles.submit')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {roles.length === 0 ? (
        <p className="text-[13px] text-muted-ink">—</p>
      ) : (
        <ul className="divide-y divide-line-2">
          {roles.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 py-2.5">
              <div className="flex items-center gap-3">
                <StatusBadge tone={r.until ? 'neutral' : 'info'}>{r.role}</StatusBadge>
                <span className="text-[13px] text-ink-2">
                  {t('roles.since')}: {r.since}
                  {r.until ? ` · ${t('roles.until')}: ${r.until}` : ''}
                </span>
              </div>
              {canManage && !r.until ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEndingRoleId(r.id)}
                  className="h-7 text-[12px] text-muted-ink hover:text-ink"
                >
                  {t('roles.end')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {endingRoleId ? (
        <Dialog open={true} onOpenChange={(o) => { if (!o) setEndingRoleId(null); }}>
          <DialogContent className="w-full sm:max-w-[400px] bg-surface p-0 shadow-md">
            <form onSubmit={handleEndSubmit}>
              <div className="p-6">
                <DialogTitle className="font-heading text-[17px]">{t('roles.end')}</DialogTitle>
                <div className="mt-4">
                  <FormField id="until" label={t('roles.until')}>
                    <Input
                      id="until"
                      name="until"
                      type="date"
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                      required
                    />
                  </FormField>
                </div>
              </div>
              <DialogFooter className="items-center border-t border-line bg-surface-2 px-6 py-3">
                <Button type="button" variant="ghost" onClick={() => setEndingRoleId(null)}>
                  {c('cancel')}
                </Button>
                <Button type="submit" disabled={endPending}>
                  {t('roles.end')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
