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
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { addContactRoleAction, endContactRoleAction, updateContactRoleAction } from '../actions';
import { FixedValue } from '@/components/fixed-value';
import { Switch } from '@/components/ui/switch';
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
  membership,
}: {
  /** Mitgliedschaft als Zeile in „Rollen“ (Handoff Mitglieder D4, 8a): Marke, Nummer · Art · seit, rechts „Öffnen“. */
  membership?: { href: string; summary: string; badge: { tone: 'info' | 'warning'; label: string } | null } | null;
  /** „Heute“ in der Zeitzone des Vereins, vom Server (Befund 47) — Vorgabe für „Seit“ und „Bis“. */
  today: string;
  contactId: string;
  /** Der Untertitel des Dialogs nennt den Kontakt (04 A3). */
  contactName: string;
  /** `note` ist bei Rollen mit `representation` das Amt; `representsAssociation` „vertritt nach § 26 BGB“ (Ve-L-5). */
  /** `managed`: führt ein Modul diese Zeile? Fehlt es, gilt die Definition (V-1: Zeilen von vor Gremien bleiben von Hand). */
  roles: { id: string; role: string; since: string; until: string | null; note?: string | null; representsAssociation?: boolean; managed?: boolean }[];
  /** `representation`: die Rolle kann den Verein vertreten (Finanzen: Vorstandsmitglied) — Amt und Schalter im Dialog. */
  roleDefinitions: { key: string; retention: string; managed?: boolean; representation?: true }[];
  canManage: boolean;
}) {
  // Geführte Rollen (z. B. „Mitglied“) setzt und beendet nur ihr Modul: nicht wählbar, ohne „Beenden“ (Spec § 3.2).
  const managed = new Set(roleDefinitions.filter((d) => d.managed).map((d) => d.key));
  // Amt und Vertretung generisch über das Kennzeichen der Definition, nie über einen Schlüssel (Prinzip 1).
  const representing = new Set(roleDefinitions.filter((d) => d.representation).map((d) => d.key));
  const choosable = roleDefinitions.filter((d) => !d.managed);
  // Die laufende Rolle der Mitgliedschaft steht als eigene Zeile oben, nicht doppelt.
  const listed = membership ? roles.filter((r) => !(managed.has(r.role) && (!r.until || r.until >= today))) : roles;
  const t = useTranslations('contacts');
  const c = useTranslations('common');
  const fmt = useDateFormat();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState(roleDefinitions.find((d) => !d.managed)?.key ?? '');
  const [since, setSince] = useState(today);
  const [office, setOffice] = useState('');
  const [represents, setRepresents] = useState(false);
  const [addPending, startAdd] = useTransition();
  const [editing, setEditing] = useState<{ id: string; role: string; since: string } | null>(null);
  const [editPending, startEdit] = useTransition();
  const editFb = useActionFeedback();
  const addFb = useActionFeedback();
  const endFb = useActionFeedback();

  const [endingRoleId, setEndingRoleId] = useState<string | null>(null);
  const [until, setUntil] = useState(today);
  const [endPending, startEnd] = useTransition();

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole || !since) return;
    startAdd(async () => {
      const extra = representing.has(selectedRole) ? { note: office.trim() || null, representsAssociation: represents } : undefined;
      const result = await addFb.run(() => addContactRoleAction(contactId, selectedRole, since, extra));
      if (result.status === 'success') setAddOpen(false);
    });
  };

  const openEdit = (r: { id: string; role: string; since: string; note?: string | null; representsAssociation?: boolean }) => {
    setOffice(r.note ?? '');
    setRepresents(r.representsAssociation === true);
    editFb.reset();
    setEditing({ id: r.id, role: r.role, since: r.since });
  };
  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    startEdit(async () => {
      const result = await editFb.run(() => updateContactRoleAction(contactId, editing.id, { note: office.trim() || null, representsAssociation: represents }));
      if (result.status === 'success') setEditing(null);
    });
  };
  const addErrors = addFb.state.status === 'error' ? addFb.state.fieldErrors : {};
  const editErrors = editFb.state.status === 'error' ? editFb.state.fieldErrors : {};
  /** Amt und „vertritt nach § 26 BGB“ (Designer 2b) — im Dialog „Rolle hinzufügen“ und „Rolle bearbeiten“. */
  const boardFields = (errors: Record<string, string>) => (
    <>
      <FormField id="role-office" label={t('roles.office')} hint={t('roles.officeHint')} error={errors.note}>
        <Input id="role-office" value={office} maxLength={500} onChange={(e) => setOffice(e.target.value)} />
      </FormField>
      <FormField id="role-represents" label={t('roles.represents')} hint={t('roles.representsHint')} error={errors.representsAssociation} toggle>
        <Switch id="role-represents" checked={represents} onCheckedChange={(checked) => setRepresents(checked === true)} />
      </FormField>
    </>
  );

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
              <Dialog
                open={addOpen}
                onOpenChange={(o) => {
                  // Jedes Öffnen beginnt leer: Amt und Schalter teilen sich den Zustand mit „Rolle bearbeiten“ (Review U1).
                  if (o) {
                    setOffice('');
                    setRepresents(false);
                    addFb.reset();
                  }
                  setAddOpen(o);
                }}
              >
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
                            onChange={(e) => {
                              setSelectedRole(e.target.value);
                              setOffice('');
                              setRepresents(false);
                            }}
                            required
                          >
                            {choosable.map((d) => (
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
                        {representing.has(selectedRole) ? boardFields(addErrors) : null}
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
        {listed.length === 0 && !membership ? (
          <p className="text-meta text-muted-ink"><Empty /></p>
        ) : (
          <ul className="divide-y divide-line-2">
            {membership ? (
              <li data-testid="contact-membership" className="flex items-center justify-between gap-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex min-w-36 flex-wrap items-center gap-1.5">
                    <StatusBadge tone={statusTone('role', 'current')}>{roleLabel(t, 'member')}</StatusBadge>
                    {membership.badge ? <StatusBadge tone={membership.badge.tone} dot>{membership.badge.label}</StatusBadge> : null}
                  </span>
                  <span className="text-meta text-ink-2">{membership.summary}</span>
                </div>
                <Link href={membership.href} className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'shrink-0')}>
                  {t('roles.open')}
                </Link>
              </li>
            ) : null}
            {/* Laufende zuerst, beendete gedämpft darunter (Runde 3, 039). */}
            {[...listed.filter((r) => !r.until), ...listed.filter((r) => r.until)].map((r) => (
              <li key={r.id} data-state={r.until ? 'ended' : 'current'} className={cn('flex items-center justify-between gap-4 py-2.5', r.until && 'text-muted-ink')}>
                {/* Die Marke steht in einer Spalte fester Mindestbreite, damit die Daten nicht hinter verschieden breiten
                    Marken springen (04 B13). Kein Layout-Test für diese Einzelstelle (AGENTS.md). */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-36"><StatusBadge tone={statusTone('role', r.until ? 'ended' : 'current')}>{roleLabel(t, r.role)}</StatusBadge></span>
                  <span className={cn('text-meta', r.until ? 'text-muted-ink' : 'text-ink-2')}>
                    {t('roles.since')}: {fmt.date(r.since)}
                    {r.until ? ` · ${t('roles.until')}: ${fmt.date(r.until)}` : ''}
                    {representing.has(r.role) && r.note ? ` · ${r.note}` : ''}
                    {representing.has(r.role) && r.representsAssociation ? ` · ${t('roles.represents')}` : ''}
                  </span>
                </div>
                {canManage && !r.until && !(r.managed ?? managed.has(r.role)) ? (
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    {representing.has(r.role) ? (
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                        {t('roles.edit')}
                      </Button>
                    ) : null}
                    {/* Rahmenknopf wie „Entfernen“ bei den Wegen; der graue Textknopf wirkte gesperrt (04 B13, 04 B14). */}
                    <Button size="sm" variant="outline" onClick={() => setEndingRoleId(r.id)}>
                      {t('roles.end')}
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {editing ? (
          <Dialog open={true} onOpenChange={(o) => { if (!o) setEditing(null); }}>
            <DialogContent size="sm" className="bg-surface shadow-md">
              <form onSubmit={handleEditSubmit}>
                <DialogTitle>{t('roles.editTitle')}</DialogTitle>
                <DialogDescription>{t('forContact', { name: contactName })}</DialogDescription>
                <div className="mt-4">
                  <FormGrid>
                    <FixedValue id="role-fixed" label={t('roles.field')} value={roleLabel(t, editing.role)} reason={t('roles.fixed')} />
                    <FixedValue id="role-since-fixed" label={t('roles.since')} value={fmt.date(editing.since)} size="s" reason={t('roles.fixed')} />
                    {boardFields(editErrors)}
                  </FormGrid>
                </div>
                <FormActionBar placement="dialog" mode="run" cancel={() => setEditing(null)} pending={editPending} saveLabel={c('save')} state={editFb.state} />
              </form>
            </DialogContent>
          </Dialog>
        ) : null}

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
