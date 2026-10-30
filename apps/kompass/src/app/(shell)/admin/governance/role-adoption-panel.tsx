'use client';

import type { AdoptableRoleRow } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { Empty } from '@/components/empty-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adoptRoleRowsAction } from './actions';

/** Rollenübernahme (Spec § 3.4): je Rollenzeile ein Amt oder „Nicht übernehmen“; „Übernehmen“ legt die Inhaberschaften an. */
export function RoleAdoptionPanel({ rows, offices, roleNames }: { rows: AdoptableRoleRow[]; offices: { id: string; name: string }[]; roleNames: Record<string, string> }) {
  const t = useTranslations('governance.admin.roles');
  const { date } = useDateFormat();
  const router = useRouter();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const items = Object.entries(choice).filter(([, officeId]) => officeId !== '').map(([rowId, officeId]) => ({ rowId, officeId }));
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => adoptRoleRowsAction(items), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    setChoice({});
    router.refresh();
  };
  if (rows.length === 0) return <EmptyState title={t('emptyTitle')} text={t('emptyText')} />;
  const officeName = new Map(offices.map((o) => [o.id, o.name]));
  return (
    <FormCard>
      <FormCardBody>
        <Section title={t('title')} intro={t('intro')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.person')}</TableHead>
                <TableHead col="meta">{t('columns.role')}</TableHead>
                <TableHead col="meta" wrap>{t('columns.note')}</TableHead>
                <TableHead col="meta">{t('columns.period')}</TableHead>
                <TableHead>{t('columns.office')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.rowId}>
                  <TableCell col="title">{r.name}</TableCell>
                  <TableCell col="meta">{roleNames[r.role] ?? r.role}</TableCell>
                  <TableCell col="meta" wrap>{r.note ?? <Empty />}</TableCell>
                  <TableCell col="meta">{t('period', { since: date(r.since), until: r.until ? date(r.until) : 'none' })}</TableCell>
                  <TableCell>
                    <Select id={`adopt-${r.rowId}`} aria-label={t('officeFor', { name: r.name })} value={choice[r.rowId] ?? ''} onChange={(e) => setChoice((c) => ({ ...c, [r.rowId]: e.target.value }))}>
                      <option value="">{t('skip')}</option>
                      {r.offices.map((id) => <option key={id} value={id}>{officeName.get(id) ?? id}</option>)}
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      </FormCardBody>
      <FormActionBar mode="edit" onSave={() => void save()} pending={pending} count={items.length} onDiscard={() => setChoice({})} state={feedback.state} saveLabel={t('adopt')} />
    </FormCard>
  );
}
