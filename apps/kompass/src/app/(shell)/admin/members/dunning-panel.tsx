'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { LocalizedField } from '@/components/forms/localized-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { saveMembersSettingsAction } from './actions';

export interface DunningLevelRow {
  key: string;
  name: Record<string, string>;
  label: string;
  daysAfter: number;
  snippetId: string | null;
}

/**
 * Mahnstufen (Handoff Mitglieder 2.6, 7c): Stufe · Name · Frühestens · Textbaustein · ⋯. Der Stufentext steht im
 * Textbaustein der Akte; Kompass schreibt keine Folge nach der Satzung hinein. Gespeichert wird die ganze Liste.
 */
export function DunningPanel({ levels, snippets, locales }: { levels: DunningLevelRow[]; snippets: { id: string; name: string }[]; locales: string[] }) {
  const t = useTranslations('members.admin.dunning');
  const tc = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<DunningLevelRow | 'new' | null>(null);
  const feedback = useActionFeedback();
  const asInput = (list: DunningLevelRow[]) => list.map((l) => ({ key: l.key, name: l.name, daysAfter: l.daysAfter, snippetId: l.snippetId }));

  const remove = async (row: DunningLevelRow) => {
    const result = await feedback.run(() => saveMembersSettingsAction({ dunningLevels: asInput(levels.filter((l) => l.key !== row.key)) }, 'dunning'));
    if (result.status !== 'success') return;
    router.refresh();
  };

  return (
    <Section title={t('title')} intro={t('intro')} actions={<Button type="button" variant="outline" size="sm" onClick={() => setEditing('new')}>{t('create')}</Button>}>
      <div className="space-y-3">
        <RefusalNotice action state={feedback.state} />
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="meta">{t('columns.level')}</TableHead>
                <TableHead col="title">{t('columns.name')}</TableHead>
                <TableHead col="meta">{t('columns.earliest')}</TableHead>
                <TableHead col="meta">{t('columns.snippet')}</TableHead>
                <TableHead col="actions" className="w-11"><span className="sr-only">{tc('rowActionsColumn')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {levels.map((row, i) => (
                <TableRow key={row.key} data-testid="dunning-level-row">
                  <TableCell col="meta" className="tabular-nums text-ink-2">{i + 1}</TableCell>
                  <TableCell col="title"><RowButton aria-haspopup="dialog" onClick={() => setEditing(row)}>{row.label}</RowButton></TableCell>
                  <TableCell col="meta" className="text-ink-2">{i === 0 ? t('afterDue', { days: row.daysAfter }) : t('afterPrevious', { days: row.daysAfter, previous: levels[i - 1]!.label })}</TableCell>
                  <TableCell col="meta" className="text-ink-2">{snippets.find((s) => s.id === row.snippetId)?.name ?? <Empty />}</TableCell>
                  <TableCell col="actions" className="text-right">
                    <RowMenu
                      name={row.label}
                      items={[
                        { key: 'edit', label: t('edit'), onSelect: () => setEditing(row) },
                        { key: 'delete', label: t('delete'), kind: 'delete', onSelect: () => void remove(row), hidden: levels.length <= 1 },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      {editing ? (
        <LevelDialog
          row={editing === 'new' ? null : editing}
          snippets={snippets}
          locales={locales}
          onClose={() => setEditing(null)}
          onSave={(level) => {
            const list = editing === 'new' ? [...levels, level] : levels.map((l) => (l.key === level.key ? level : l));
            return saveMembersSettingsAction({ dunningLevels: asInput(list) }, 'dunning');
          }}
          nextKey={`level${levels.length + 1}`}
        />
      ) : null}
    </Section>
  );
}

function LevelDialog({ row, snippets, locales, onClose, onSave, nextKey }: { row: DunningLevelRow | null; snippets: { id: string; name: string }[]; locales: string[]; onClose: () => void; onSave: (level: DunningLevelRow) => ReturnType<typeof saveMembersSettingsAction>; nextKey: string }) {
  const t = useTranslations('members.admin.dunning');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [days, setDays] = useState(String(row?.daysAfter ?? 28));
  const [snippetId, setSnippetId] = useState(row?.snippetId ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const save = async () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    const name = Object.fromEntries(locales.map((l) => [l, String(data.get(`name.${l}`) ?? '').trim()]).filter(([, v]) => v));
    setPending(true);
    const result = await feedback.run(() => onSave({ key: row?.key ?? nextKey, name, label: '', daysAfter: Number(days), snippetId: snippetId || null }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{row ? t('dialogEdit') : t('dialogNew')}</DialogTitle>
        </DialogHeader>
        <form ref={form} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              <LocalizedField name="name" label={t('name')} value={row?.name ?? {}} locales={locales} required />
              <FormField id="level-days" label={t('days')} hint={t('daysHint')} required size="s">
                <Input id="level-days" type="number" min={0} max={365} unit={t('daysUnit')} value={days} onChange={(e) => setDays(e.target.value)} />
              </FormField>
              <FormField id="level-snippet" label={t('snippet')}>
                <Select id="level-snippet" value={snippetId} onChange={(e) => setSnippetId(e.target.value)}>
                  <option value="">{t('snippetNone')}</option>
                  {snippets.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </FormField>
            </FormGrid>
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} testId="dunning-level-footer" />
      </DialogContent>
    </Dialog>
  );
}
