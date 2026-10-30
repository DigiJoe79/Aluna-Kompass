import type { StatuteContext } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Empty } from '@/components/empty-value';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { Section } from '@/components/section';
import { buttonVariants } from '@/components/ui/button';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { ruleRowsFor } from '@/lib/governance/rule-rows';
import { resolvedOrganRules, ruleText } from '@/lib/governance/rule-text';

const link = 'text-link underline-offset-2 hover:underline';

/**
 * Lesesicht eines Satzungsstands (Board 5b): Wortlaut, Beschluss und Eintragung, Bewertung durch das Finanzamt und das
 * Regelwerk je Organ — Rückfälle ganz gedämpft mit „laut Gesetz: …“ und der Norm als Fundstelle.
 */
export async function StatuteView({ context, date, manage }: { context: StatuteContext; date: (iso: string) => string; manage: boolean }) {
  const t = await getTranslations('governance');
  const tw = await getTranslations('governance.rules.words');
  const tm = await getTranslations('governance.majority');
  const tk = await getTranslations('governance.agendaKinds');
  const s = context.statute;
  const officeNames = new Map(context.organs.flatMap((o) => o.offices.map((x) => [x.id, x.name] as const)));
  const office = (id: string) => officeNames.get(id) ?? id;
  const dl = (rows: [string, React.ReactNode][]) => (
    <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-[12rem_minmax(0,1fr)]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-meta text-muted-ink">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
  const r = s.taxReview;
  const assemblyName = context.organs.find((o) => o.kind === 'assembly')?.name ?? '';
  return (
    <div className="flex flex-col gap-4">
      <FormCard as="section">
        <FormCardBody>
          <Section title={t('statute.text')}>
            {context.document ? (
              <div className="flex flex-wrap items-center gap-3 text-body">
                <Link className={link} href={`/dms/${context.document.id}`}>{[context.document.number, context.document.subject].filter(Boolean).join(' · ')}</Link>
                <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/dms/${context.document.id}/file`} download>{t('statute.download')}</a>
              </div>
            ) : (
              <Notice level="warn">{t('statute.noText')}</Notice>
            )}
          </Section>
        </FormCardBody>
      </FormCard>
      <FormCard as="section">
        <FormCardBody>
          <Section title={t('statute.resolutionAndRegistration')}>
            {dl([
              [
                t('statute.resolution'),
                context.resolutions.length ? (
                  <ul className="flex flex-col gap-1">
                    {context.resolutions.map((x) => (
                      <li key={`${x.on}${x.resolutionId ?? ''}`}>
                        {x.resolutionId ? <Link className={link} href={`/governance/resolutions/${x.resolutionId}`}>{x.number ?? date(x.on)}</Link> : date(x.on)}
                        {x.meetingId && x.meetingKind ? (
                          <>
                            {' · '}
                            <Link className={link} href={`/governance/meetings/${x.meetingId}`}>{meetingTitle((k, v) => t(k, v), date, { kind: x.meetingKind, heldOn: x.on }, assemblyName)}</Link>
                            {x.itemPosition ? `, ${t('statute.item', { n: x.itemPosition })}` : ''}
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty />
                ),
              ],
              [t('statute.filing'), context.filing ? <Link className={link} href={`/governance/register/${context.filing.id}`}>{t(`states.registration.${context.filing.state}`)}</Link> : <Empty />],
              [t('statute.registered'), s.registeredOn ? date(s.registeredOn) : <Empty />],
            ])}
          </Section>
        </FormCardBody>
      </FormCard>
      <FormCard as="section">
        <FormCardBody>
          <Section title={t('statute.tax')}>
            <div className="flex flex-col gap-3">
              {s.warnings.map((w) => (
                <Notice key={w} level="warn">{t(`statute.warnings.${w}`)}</Notice>
              ))}
              {dl([
                [t('statute.taxQuestion'), r.affectsCharity === null ? t('statute.open') : t(r.affectsCharity ? 'rules.words.yes' : 'rules.words.no')],
                [t('statute.submitted'), r.submittedOn ? <>{date(r.submittedOn)}{context.taxDocuments.submission ? <> · <Link className={link} href={`/dms/${context.taxDocuments.submission.id}`}>{context.taxDocuments.submission.number ?? t('statute.document')}</Link></> : null}</> : <Empty />],
                [t('statute.answer'), r.answer ? <>{t(`statute.answers.${r.answer}`)}{context.taxDocuments.answer ? <> · <Link className={link} href={`/dms/${context.taxDocuments.answer.id}`}>{context.taxDocuments.answer.number ?? t('statute.document')}</Link></> : null}</> : <Empty />],
              ])}
            </div>
          </Section>
        </FormCardBody>
      </FormCard>
      <FormCard as="section">
        <FormCardBody>
          <Section title={t('statute.rules')} intro={t('statute.rulesIntro')} actions={manage ? <Link href={`/governance/statutes/${s.id}/rules`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('statute.editRules')}</Link> : undefined}>
            <div className="flex flex-col gap-5">
              {context.organs.map((organ) => {
                const effective = resolvedOrganRules(s.rules, organ.id);
                return (
                  <div key={organ.id} className="flex flex-col">
                    <Overline>{organ.name}</Overline>
                    <ul className="mt-2 flex flex-col">
                      {ruleRowsFor(organ, s.rules).map((row) => {
                        const text = ruleText(row.key, effective, organ.kind, { t: tw, tm, tk, office });
                        const law = row.source === 'law';
                        return (
                          <li key={row.key} id={`rule-${row.key}`} className={`grid gap-x-4 gap-y-0.5 border-b border-line-2 py-2 text-body last:border-b-0 md:grid-cols-[14rem_minmax(0,1fr)_12rem] ${law ? 'text-muted-ink' : ''}`}>
                            <span className={law ? '' : 'text-ink-2'}>{t(`rules.labels.${row.key.startsWith('majority.') ? 'majority' : row.key}`, { kind: row.key.startsWith('majority.') ? tk(row.key.slice(9)) : '' })}</span>
                            <span className="min-w-0">{law ? t('statute.byLaw', { text }) : text}</span>
                            <span className="text-meta md:text-right">{law ? row.norm : (row.reference ?? t('majority.sourceStatute'))}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Section>
        </FormCardBody>
      </FormCard>
    </div>
  );
}
