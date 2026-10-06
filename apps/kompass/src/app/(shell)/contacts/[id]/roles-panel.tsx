'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { roleLabel } from '@/lib/contact-roles';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { addContactRoleAction, endContactRoleAction } from '../actions';
import { Select } from '@/components/ui/select';

export function RolesPanel({
  contactId,
  roles,
  roleDefinitions,
  canManage,
  today,
}: {
  /** „Heute“ in der Zeitzone des Vereins, vom Server (Befund 47) — Vorgabe für „Seit“ und „Bis“. */
  today: string;
  contactId: string;
  roles: { id: string; role: string; since: string; until: string | null }[];
  roleDefinitions: { key: string; retention: string }[];
  canManage: boolean;
}) {
  const t = useTranslations('contacts');
  const c = useTranslations('common');
  const fmt = useDateFormat();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState(roleDefinitions[0]?.key ?? '');
  const [since, setSince] = useState(today);
  const [addPending, startAdd] = useTransition();
  const addFb = useActionFeedback();
  const endFb = useActionFeedback();

  const [endingRoleId, setEndingRoleId] = useState<string | null>(null);
  const [until, setUntil] = useState(today);
  const [endPending, startEnd] = useTransition();

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole || !since) return;
    startAdd(async () => {
      const result = await addFb.run(() => addContactRoleAction(contactId, selectedRole, since));
      if (result.status === 'success') setAddOpen(false);
    });
  };

  const handleEndSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!endingRoleId || !until) return;
    startEnd(async () => {
      const result = await endFb.run(() => endContactRoleAction(contactId, endingRoleId, until));
      if (result.status === 'success') setEndingRoleId(null);
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
                  {t('roles.add')}
                </Button>
              }
            />
            <DialogContent size="sm" className="bg-surface shadow-md">
              <form onSubmit={handleAddSubmit}>
                <DialogTitle className="font-heading text-[17px]">{t('roles.add')}</DialogTitle>
                <DialogDescription className="text-[13px] text-muted-ink">
                  {t('roles.title')}
                </DialogDescription>

                <div className="mt-4">
                  <FormGrid>
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
                            {roleLabel(t, d.key)}
                          </option>
                        ))}
                      </Select>
                    </FormField>

                    <FormField id="since" label={t('roles.since')} size="s">
                      <Input
                        id="since"
                        name="since"
                        type="date"
                        value={since}
                        onChange={(e) => setSince(e.target.value)}
                        required
                      />
                    </FormField>
                  </FormGrid>
                </div>

                <FormActionBar placement="dialog" mode="create" cancel={() => setAddOpen(false)} pending={addPending} saveLabel={t('roles.submit')} state={addFb.state} />
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
                <StatusBadge tone={r.until ? 'neutral' : 'info'}>{roleLabel(t, r.role)}</StatusBadge>
                <span className="text-[13px] text-ink-2">
                  {t('roles.since')}: {fmt.date(r.since)}
                  {r.until ? ` · ${t('roles.until')}: ${fmt.date(r.until)}` : ''}
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
          <DialogContent size="sm" className="bg-surface shadow-md">
            <form onSubmit={handleEndSubmit}>
              <DialogTitle className="font-heading text-[17px]">{t('roles.end')}</DialogTitle>
              <div className="mt-4">
                <FormGrid>
                  <FormField id="until" label={t('roles.until')} size="s">
                    <Input
                      id="until"
                      name="until"
                      type="date"
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                      required
                    />
                  </FormField>
                </FormGrid>
              </div>
              <FormActionBar placement="dialog" mode="create" cancel={() => setEndingRoleId(null)} pending={endPending} saveLabel={t('roles.end')} state={endFb.state} />
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
