'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { LocalizedField } from '@/components/forms/localized-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Empty } from '@/components/empty-value';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MutedMark, RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { saveMemberTypeAction, setMemberTypeActiveAction, deleteMemberTypeAction } from './actions';

export interface MemberTypeRow {
  id: string;
  key: string;
  name: Record<string, string>;
  label: string;
  hasVotingRight: boolean;
  feeExempt: boolean;
  active: boolean;
  count: number;
}

/** Ein Schlüssel aus dem Namen der Leitsprache — fest nach der Anlage, gezeigt wird er nicht (MUSTER § Begriffe). */
const keyFrom = (name: string) =>
  name
    .toLocaleLowerCase('de')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40) || 'art';

/**
 * Mitgliedsarten (Handoff Mitglieder 2.6, 7b): Name · Stimmrecht · Beitrag · Zahl der Mitglieder · ⋯. Eine deaktivierte
 * Art ist eine gedämpfte Zeile (MUSTER § G, Ja/Nein-Liste). Löschen nur ohne je eine Mitgliedschaft; sonst nennt die
 * Ablehnung die Zahl.
 */
export function TypesPanel({ types, locales }: { types: MemberTypeRow[]; locales: string[] }) {
  const t = useTranslations('members.admin.types');
  const tc = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<MemberTypeRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MemberTypeRow | null>(null);
  const feedback = useActionFeedback();

  const toggle = async (row: MemberTypeRow) => {
    const result = await feedback.run(() => setMemberTypeActiveAction(row.id, !row.active));
    if (result.status !== 'success') return;
    toast.success(result.message);
    router.refresh();
  };

  return (
    <Section title={t('title')} actions={<Button type="button" variant="outline" size="sm" onClick={() => setEditing('new')} data-testid="member-type-create">{t('create')}</Button>}>
      <div className="space-y-3">
        <RefusalNotice action state={feedback.state} />
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.name')}</TableHead>
                <TableHead col="meta">{t('columns.voting')}</TableHead>
                <TableHead col="meta">{t('columns.fee')}</TableHead>
                {/* Zählspalte ohne Rolle: Eine 0 zeigt „—“ (MUSTER § G, Leere Werte und Nullen). */}
                <TableHead className="text-right">{t('columns.count')}</TableHead>
                <TableHead col="actions" className="w-11"><span className="sr-only">{tc('rowActionsColumn')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((row) => (
                <TableRow key={row.id} muted={row.active ? undefined : t('inactive')}>
                  <TableCell col="title" mutedMark="inline">
                    <span>
                      <RowButton aria-haspopup="dialog" onClick={() => setEditing(row)}>{row.label}</RowButton>
                      <MutedMark />
                    </span>
                  </TableCell>
                  <TableCell col="meta" className="text-ink-2">{row.hasVotingRight ? t('yes') : t('no')}</TableCell>
                  <TableCell col="meta" className="text-ink-2">{row.feeExempt ? t('exempt') : t('bySchedule')}</TableCell>
                  <TableCell className="text-right tabular-nums text-ink-2">{row.count > 0 ? row.count : <Empty />}</TableCell>
                  <TableCell col="actions" className="text-right">
                    <RowMenu
                      name={row.label}
                      items={[
                        { key: 'edit', label: t('edit'), onSelect: () => setEditing(row) },
                        { key: 'toggle', label: row.active ? t('deactivate') : t('activate'), onSelect: () => void toggle(row) },
                        { key: 'delete', label: t('delete'), kind: 'delete', onSelect: () => setDeleting(row) },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      {editing ? <TypeDialog row={editing === 'new' ? null : editing} locales={locales} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={t('deleteTitle')}
        description={deleting ? t('deleteDescription', { name: deleting.label }) : ''}
        confirmLabel={t('deleteConfirm')}
        destructive
        action={async () => {
          const result = await deleteMemberTypeAction(deleting!.id);
          if (result.status === 'success') router.refresh();
          return result;
        }}
      />
    </Section>
  );
}

function TypeDialog({ row, locales, onClose }: { row: MemberTypeRow | null; locales: string[]; onClose: () => void }) {
  const t = useTranslations('members.admin.types');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [voting, setVoting] = useState(row?.hasVotingRight ?? true);
  const [exempt, setExempt] = useState(row?.feeExempt ?? false);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const save = async () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    const name = Object.fromEntries(locales.map((l) => [l, String(data.get(`name.${l}`) ?? '').trim()]).filter(([, v]) => v));
    setPending(true);
    const result = await feedback.run(
      () => saveMemberTypeAction({ ...(row ? { id: row.id } : { key: keyFrom(name[locales[0]!] ?? '') }), name, hasVotingRight: voting, feeExempt: exempt }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    onClose();
    router.refresh();
  };

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{row ? t('dialogEdit') : t('dialogNew')}</DialogTitle>
        </DialogHeader>
        {/* Das Formular umfasst nur die Felder: Die mehrsprachigen Namen kommen aus seinen Daten; die Leiste darunter zählt
            nicht selbst (wie die Dialoge der Zwecke). */}
        <form ref={form} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              <LocalizedField name="name" label={t('name')} value={row?.name ?? {}} locales={locales} errors={errors} required />
              <FormField id="type-voting" label={t('voting')} toggle size="full">
                <Checkbox id="type-voting" checked={voting} onCheckedChange={(on) => setVoting(on === true)} />
              </FormField>
              <FormField id="type-exempt" label={t('feeExempt')} toggle size="full">
                <Checkbox id="type-exempt" checked={exempt} onCheckedChange={(on) => setExempt(on === true)} />
              </FormField>
            </FormGrid>
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} testId="member-type-footer" />
      </DialogContent>
    </Dialog>
  );
}
