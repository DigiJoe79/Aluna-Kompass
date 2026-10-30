'use client';

import type { CircularContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Notice } from '@/components/notice';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CircularState } from '@/lib/governance/circular-state';
import { DecideDialog } from './decide-dialog';
import { ResponseDialog } from './response-dialog';

const link = 'text-link underline-offset-2 hover:underline';

/** Der Umlauf (Vorgang ohne Schritte, Board 7a): Stand der Zustimmungen, Antrag, Antworten. */
export function CircularView({ context, state, ruleText, ruleRef, detailsText, today, manage, canPickDocuments, chairId }: { context: CircularContext; state: CircularState; ruleText: string; ruleRef: string; detailsText: string | null; today: string; manage: boolean; canPickDocuments: boolean; chairId: string | null }) {
  const t = useTranslations('governance.circular');
  const tw = useTranslations('governance.live.detailWarnings');
  const { date } = useDateFormat();
  const c = context.circular;
  const e = c.evaluation;
  const [answering, setAnswering] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const sealed = c.sealedAt !== null;
  const people = c.responses.filter((r) => r.contactId).map((r) => ({ id: r.contactId!, name: context.names[r.contactId!] ?? '' }));
  const answerRow = c.responses.find((r) => r.id === answering) ?? null;
  const open = e.total - e.yes - e.no - e.abstain;
  return (
    <div className="flex flex-col gap-4">
      {c.warnings.includes('circularNotAllowed') ? <Notice level="warn">{t('notAllowed')}</Notice> : null}
      {c.warnings.includes('answerAfterDeadline') ? <Notice level="warn">{t('answerAfterDeadline')}</Notice> : null}
      {c.warnings.includes('excludedAnswered') ? <Notice level="warn">{t('excludedAnswered')}</Notice> : null}
      {c.warnings.filter((w) => w === 'statuteRegistered' || w === 'statuteNotAssembly' || w === 'remunerationWithoutStatute' || w === 'remunerationWrongOrgan' || w === 'expenseRuleRetroactive' || w === 'exclusionChecklistOpen' || w === 'detailsMissing').map((w) => <Notice key={w} level="warn">{tw(w)}</Notice>)}
      {sealed ? (
        <p className="flex flex-wrap items-center gap-2 text-body">
          <StatusBadge tone="final" dot>{t('sealedAs', { number: context.resolution?.number ?? '' })}</StatusBadge>
          {context.resolution ? <Link className={link} href={`/governance/resolutions/${context.resolution.id}`}>{t('toResolution')}</Link> : null}
        </p>
      ) : e.reached ? (
        <p className="flex flex-wrap items-center gap-3 text-body">
          <StatusBadge tone="success" dot>{t('reachedOn', { date: e.reachedOn ? date(e.reachedOn) : '' })}</StatusBadge>
          {manage ? <Button type="button" onClick={() => setDeciding(true)}>{t('decide')}</Button> : null}
        </p>
      ) : !e.possible ? (
        <Notice level="warn" title={t('impossible')} action={manage ? <Button type="button" variant="outline" size="sm" onClick={() => setDeciding(true)}>{t('decideImpossible')}</Button> : undefined}>
          {t('tally', { needed: e.needed, total: e.total, rule: ruleText, reference: ruleRef, yes: e.yes, no: e.no, open })}
        </Notice>
      ) : (
        <Notice level="warn" title={t('missing', { n: e.needed - e.yes })}>
          {t('tally', { needed: e.needed, total: e.total, rule: ruleText, reference: ruleRef, yes: e.yes, no: e.no, open })} {t('noAnswerNoConsent')}
        </Notice>
      )}
      <FormCard as="section"><FormCardBody>
        <Section title={t('request')}>
          <p className="whitespace-pre-line text-body">{c.text}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-body sm:grid-cols-[12rem_minmax(0,1fr)]">
            <dt className="text-meta text-muted-ink">{t('channel')}</dt><dd>{t(`channels.${c.channel}`)}</dd>
            <dt className="text-meta text-muted-ink">{t('deadline')}</dt><dd>{date(c.deadline)}</dd>
            {detailsText ? (<><dt className="text-meta text-muted-ink">{t('details')}</dt><dd>{detailsText}</dd></>) : null}
          </dl>
        </Section>
      </FormCardBody></FormCard>
      <FormCard as="section"><FormCardBody>
        <Section title={t('responses')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.member')}</TableHead>
                <TableHead col="meta">{t('columns.answer')}</TableHead>
                <TableHead col="meta">{t('columns.on')}</TableHead>
                <TableHead col="meta" wrap>{t('columns.proof')}</TableHead>
                {manage && !sealed ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.responses.map((r) => {
                const name = r.contactId ? (context.names[r.contactId] ?? '') : t('deletedContact');
                const doc = r.documentId ? context.documents[r.documentId] : null;
                return (
                  <TableRow key={r.id} data-testid="circular-response">
                    <TableCell col="title">
                      {name}
                      {r.contactId && context.offices[r.contactId] ? <span className="block text-meta text-muted-ink">{context.offices[r.contactId]}</span> : null}
                    </TableCell>
                    <TableCell col="meta">{t(`answerWords.${r.answer}`)}</TableCell>
                    <TableCell col="meta">{r.answeredOn ? date(r.answeredOn) : <Empty />}</TableCell>
                    <TableCell col="meta" wrap>{r.documentId ? <Link className={link} href={`/dms/${r.documentId}`}>{doc?.number ?? doc?.subject ?? t('document')}</Link> : (r.note ?? <Empty />)}</TableCell>
                    {manage && !sealed ? (
                      <TableCell col="actions">
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          {r.answer === 'none' ? <Button type="button" variant="outline" size="sm" onClick={() => setAnswering(r.id)}>{t('answerButton')}</Button> : null}
                          <RowMenu name={name} items={[{ key: 'edit', label: t('edit'), onSelect: () => setAnswering(r.id) }]} />
                        </span>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      </FormCardBody></FormCard>
      {answerRow ? (
        <ResponseDialog
          circularId={c.id}
          response={{ id: answerRow.id, answer: answerRow.answer, answeredOn: answerRow.answeredOn, documentId: answerRow.documentId, documentLabel: answerRow.documentId ? (context.documents[answerRow.documentId]?.subject ?? null) : null, note: answerRow.note }}
          name={answerRow.contactId ? (context.names[answerRow.contactId] ?? '') : ''}
          today={today}
          canPickDocuments={canPickDocuments}
          onClose={() => setAnswering(null)}
        />
      ) : null}
      {deciding ? <DecideDialog circularId={c.id} today={today} people={people} chairId={chairId} reached={e.reached} onClose={() => setDeciding(false)} /> : null}
    </div>
  );
}
