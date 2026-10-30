'use client';

import type { OfficeView, OrganTermRow } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRouter } from 'next/navigation';
import { setOfficeActiveAction } from '../actions';
import { OfficeDialog } from './office-dialog';
import { TermEndDialog } from './term-end-dialog';

/** Nebenlisten am Organ (Board 4b): Ämter und Amtsinhaber; frühere Inhaber gedämpft. */
export function OrganLists({ organId, offices, terms, meetingNames, manage, today, termEndReasons, canPickDocuments }: { organId: string; offices: OfficeView[]; terms: OrganTermRow[]; meetingNames: Record<string, string>; manage: boolean; today: string; termEndReasons: readonly string[]; canPickDocuments: boolean }) {
  const t = useTranslations('governance.organ');
  const to = useTranslations('governance.office');
  const { date } = useDateFormat();
  const router = useRouter();
  const [editing, setEditing] = useState<OfficeView | null>(null);
  const [ending, setEnding] = useState<OrganTermRow | null>(null);
  const feedback = useActionFeedback();
  const others = (id: string | null) => offices.filter((o) => o.id !== id).map((o) => ({ id: o.id, name: o.name }));
  const term = (o: OfficeView) => [o.termMonths === null ? to('unlimited') : to('termMonthsValue', { n: o.termMonths }), o.untilSuccessor ? to('untilSuccessorShort') : null].filter(Boolean).join(', ');
  const origin = (r: OrganTermRow) => {
    const o = r.origin;
    switch (o.kind) {
      case 'elected': {
        const text = t('origins.elected', { meeting: o.meetingId ? (meetingNames[o.meetingId] ?? '') : '', item: o.itemPosition ?? 0 });
        return o.resolutionId ? <Link className="text-link underline-offset-2 hover:underline" href={`/governance/resolutions/${o.resolutionId}`}>{text}</Link> : text;
      }
      case 'substitute':
        return o.resolutionNumber && o.resolutionId ? (
          <>{t('origins.substitute')}, <Link className="text-link underline-offset-2 hover:underline" href={`/governance/resolutions/${o.resolutionId}`}>{o.resolutionNumber}</Link></>
        ) : t('origins.substitute');
      case 'backfilled':
        return o.documentId ? (
          <>{t('origins.backfilledProof')} <Link className="text-link underline-offset-2 hover:underline" href={`/dms/${o.documentId}`}>{o.documentNumber ?? t('origins.document')}</Link></>
        ) : t('origins.backfilled');
      default:
        return t(`origins.${o.kind}`);
    }
  };
  const archive = (o: OfficeView) => feedback.run(async () => {
    const result = await setOfficeActiveAction(organId, o.id, !o.active);
    if (result.status === 'success') router.refresh();
    return result;
  });
  return (
    <div className="mt-6 flex flex-col gap-4">
      <FormCard as="section">
        <FormCardBody>
          <Section title={t('offices')}>
            {feedback.state.status === 'error' ? <RefusalNotice state={feedback.state} /> : null}
            {offices.length === 0 ? (
              <p className="text-meta text-muted-ink">{t('noOffices')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead col="title">{t('columns.office')}</TableHead>
                    <TableHead col="meta">{t('columns.seats')}</TableHead>
                    <TableHead col="meta">{t('columns.representative')}</TableHead>
                    <TableHead col="meta">{t('columns.term')}</TableHead>
                    {manage ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offices.map((o) => (
                    <TableRow key={o.id} muted={o.active ? undefined : t('archived')}>
                      <TableCell col="title">{manage ? <RowButton aria-haspopup="dialog" onClick={() => setEditing(o)}>{o.name}</RowButton> : o.name}</TableCell>
                      <TableCell col="meta">{o.seats}</TableCell>
                      <TableCell col="meta">{o.representative ? t('represents') : <Empty />}</TableCell>
                      <TableCell col="meta">{term(o)}</TableCell>
                      {manage ? (
                        <TableCell col="actions">
                          <RowMenu name={o.name} items={[{ key: 'edit', label: t('edit'), onSelect: () => setEditing(o) }, { key: 'archive', label: o.active ? to('archive') : to('activate'), onSelect: () => void archive(o) }]} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </FormCardBody>
      </FormCard>
      <FormCard as="section">
        <FormCardBody>
          <Section title={t('holders')} intro={t('holdersIntro')}>
            {terms.length === 0 ? (
              <p className="text-meta text-muted-ink">{t('noHolders')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead col="title">{t('columns.person')}</TableHead>
                    <TableHead col="meta">{t('columns.office')}</TableHead>
                    <TableHead col="meta">{t('columns.period')}</TableHead>
                    <TableHead col="meta" wrap>{t('columns.origin')}</TableHead>
                    {manage ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terms.map((r) => (
                    <TableRow key={r.id} muted={r.running ? undefined : t('former')}>
                      <TableCell col="title">{r.name || <Empty />}</TableCell>
                      <TableCell col="meta">{r.officeName}</TableCell>
                      <TableCell col="meta">{t('period', { since: date(r.since), until: r.until ? date(r.until) : 'none' })}</TableCell>
                      <TableCell col="meta" wrap>{origin(r)}</TableCell>
                      {manage ? (
                        <TableCell col="actions">
                          {r.running ? <RowMenu name={r.name} items={[{ key: 'end', label: t('endTerm'), onSelect: () => setEnding(r) }]} /> : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </FormCardBody>
      </FormCard>
      {editing ? <OfficeDialog organId={organId} office={editing} others={others(editing.id)} onClose={() => setEditing(null)} /> : null}
      {ending ? <TermEndDialog organId={organId} term={{ id: ending.id, name: ending.name, officeName: ending.officeName }} reasons={termEndReasons} today={today} canPickDocuments={canPickDocuments} onClose={() => setEnding(null)} /> : null}
    </div>
  );
}
