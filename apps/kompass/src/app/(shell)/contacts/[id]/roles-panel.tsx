'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { roleLabel } from '@/lib/contact-roles';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { addContactRoleAction, endContactRoleAction } from '../actions';
import { Select } from '@/components/ui/select';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';

export function RolesPanel({
  contactId,
  contactName,
  roles,
  roleDefinitions,
  canManage,
  today,
}: {
  /** „Heute“ in der Zeitzone des Vereins, vom Server (Befund 47) — Vorgabe für „Seit“ und „Bis“. */
  today: string;
  contactId: string;
  /** Der Untertitel des Dialogs nennt den Kontakt (04 A3). */
  contactName: string;
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
      <Section title={t('roles.title')}
        actions={
          <>
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
                    <DialogTitle>{t('roles.add')}</DialogTitle>
                    <DialogDescription>{t('forContact', { name: contactName })}</DialogDescription>

                    <div className="mt-4">
                      <FormGrid>
                        <FormField id="role" label={t('roles.field')} required>
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

                        <FormField id="since" label={t('roles.since')} size="s" required>
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
          </>
        }
      >
        {roles.length === 0 ? (
          <p className="text-meta text-muted-ink"><Empty /></p>
        ) : (
          <ul className="divide-y divide-line-2">
            {roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-2.5">
                {/* Die Marke steht in einer Spalte fester Mindestbreite, damit die Daten nicht hinter verschieden breiten
                    Marken springen (04 B13). Kein Layout-Test für diese Einzelstelle (AGENTS.md). */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-36"><StatusBadge tone={statusTone('role', r.until ? 'ended' : 'current')}>{roleLabel(t, r.role)}</StatusBadge></span>
                  <span className="text-meta text-ink-2">
                    {t('roles.since')}: {fmt.date(r.since)}
                    {r.until ? ` · ${t('roles.until')}: ${fmt.date(r.until)}` : ''}
                  </span>
                </div>
                {canManage && !r.until ? (
                  // Rahmenknopf wie „Entfernen“ bei den Wegen; der graue Textknopf wirkte gesperrt (04 B13, 04 B14).
                  <Button size="sm" variant="outline" onClick={() => setEndingRoleId(r.id)} className="shrink-0">
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
                <DialogTitle>{t('roles.end')}</DialogTitle>
                <div className="mt-4">
                  <FormGrid>
                    <FormField id="until" label={t('roles.until')} size="s" required>
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
      </Section>
    </section>
  );
}
