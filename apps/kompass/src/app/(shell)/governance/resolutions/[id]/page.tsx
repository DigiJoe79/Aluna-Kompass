import { activeUserChoices, hasPermission, requirePermission, todayIn } from '@kompass/core';
import { getResolutionContext } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Empty } from '@/components/empty-value';
import { ForbiddenCard } from '@/components/forbidden-card';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Page } from '@/components/page';
import { RelatedDocuments } from '@/components/related-documents';
import { Section } from '@/components/section';
import { formatEuro } from '@/lib/finance/amount';
import { dateFormatOf } from '@/lib/date-format';
import { majorityText, ruleSource } from '@/lib/governance/majority-text';
import { isDetailsKind } from '@/lib/governance/resolution-details';
import { requireSession } from '@/lib/request-context';
import { ResolutionHeader } from './follow-up-dialog';

const link = 'text-link underline-offset-2 hover:underline';

/** Ein Beschluss als Lesesicht (Board 6b): Wortlaut, Ergebnis, Angaben, Verweise, Dokumente. */
export default async function ResolutionPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const { id } = await props.params;
  const t = await getTranslations('governance');
  const tm = await getTranslations('governance.majority');
  const res = await getResolutionContext(deps, ctx, { id });
  if (!res.ok) notFound();
  const { resolution: r, row, decidedBy, minutes, statute, filings, followUps, usedBy, names, election } = res.value;
  const fmt = dateFormatOf(deps);
  const elected = election?.elected.filter((e) => e.acceptedOn !== null && e.declinedOn === null).map((e) => e.name) ?? [];
  const state = election ? (elected.length ? 'elected' : 'notElected') : row.againstCount ? 'overridden' : (r.outcome ?? 'adopted');
  const organPhrase = row.organKind === 'assembly' ? t('resolution.ofAssembly') : row.organKind === 'board' ? t('resolution.ofBoard') : t('resolution.ofOrgan', { name: row.organName });
  const decided = r.unanimous ? t('resolution.unanimous') : row.againstCount ? t('resolution.againstCount') : r.outcome ? t(`resolution.outcomes.${r.outcome}`) : '';
  const head = [row.number, `${t(`agendaKinds.${r.kind}`)} ${organPhrase} ${t('resolution.on', { date: fmt.date(r.decidedOn) })}${row.source.kind === 'meeting' && row.source.itemPosition ? `, ${t('statute.item', { n: row.source.itemPosition })}` : ''}`].filter(Boolean).join(' · ');
  const description = `${head}. ${decided}`.trim();
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
  const v = r.votes;
  const ev = r.evaluation;
  const details = isDetailsKind(r.kind) && r.details ? (r.details as Record<string, unknown>) : null;
  const detailValue = (k: string, value: unknown): React.ReactNode => {
    if (value === null || value === undefined || value === '') return <Empty />;
    if (k.endsWith('Cents') && typeof value === 'number') return formatEuro(value);
    if (Array.isArray(value)) return value.length ? value.map((x) => names[x as string] ?? String(x)).join(', ') : <Empty />;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return fmt.date(value);
    if (typeof value === 'string' && /^(?:[A-Z0-9]{26})$/.test(value)) return names[value] ?? t('resolution.reference');
    return t.has(`details.values.${k}.${String(value)}`) ? t(`details.values.${k}.${String(value)}`) : String(value);
  };
  return (
    <Page
      width="standard"
      header={<ResolutionHeader back={{ href: '/governance/resolutions', label: t('resolution.back') }} resolutionId={r.id} title={row.election ? t('resolutions.election', { office: row.election.office, names: row.election.elected.join(', ') || t('resolutions.nobodyElected') }) : row.subject} description={description} state={state} stateLabel={t(`states.resolution.${state}`)} canFollowUp={hasPermission(ctx, 'followUps.manage')} users={activeUserChoices(deps)} today={todayIn(deps)} />}
    >
      <div className="flex flex-col gap-4">
        {election ? null : (
          <FormCard as="section"><FormCardBody>
            <Section title={t('resolution.text')}>
              <p className="whitespace-pre-line text-body">{r.text}</p>
            </Section>
          </FormCardBody></FormCard>
        )}
        <FormCard as="section"><FormCardBody>
          <Section title={t('resolution.result')}>
            {election ? dl([
              ...election.rounds.map((round): [string, React.ReactNode] => [
                round.runoff ? t('resolution.electionRunoff') : t('resolution.electionRound', { n: round.number }),
                round.unanimous ? t('resolution.electionUnanimous', { name: round.unanimous }) : [...round.candidates.map((c) => t('resolution.electionCandidate', c)), t('resolution.electionRest', { no: round.no, abstain: round.abstain, invalid: round.invalid }), t('resolution.electionNeeded', { n: round.needed })].join(', '),
              ]),
              [t('resolution.electionElected'), elected.length ? elected.join(', ') : t('resolution.electionNobody')],
              [t('resolution.electionDeclaration'), election.elected.length ? election.elected.map((e) => (e.acceptedOn ? t('resolution.electionAccepted', { name: e.name, date: fmt.date(e.acceptedOn) }) : e.declinedOn ? t('resolution.electionDeclined', { name: e.name, date: fmt.date(e.declinedOn) }) : t('resolution.electionOpen', { name: e.name }))).join('; ') : <Empty />],
            ]) : dl([
              [t('resolution.counted'), r.unanimous ? t('resolution.unanimous') : v ? t('resolution.votes', { yes: v.yes, no: v.no, abstain: v.abstain, mode: r.yesComputed ? 'computed' : 'counted' }) : <Empty />],
              [t('resolution.required'), ev ? `${majorityText(tm, ev.required.value)}, ${t('resolution.neededYes', { n: ev.result.needed })} (${ruleSource(tm, ev.required)})` : <Empty />],
              [t('resolution.decided'), r.outcome ? [t(`resolution.outcomes.${r.outcome}`), decidedBy ? t('resolution.by', { name: decidedBy }) : null, r.votedAt].filter(Boolean).join(', ') : <Empty />],
              [t('resolution.reason'), r.outcomeReason ? <span className="whitespace-pre-line">{r.outcomeReason}</span> : <Empty />],
              [t('resolution.excluded'), r.excluded.length ? r.excluded.map((e) => `${names[e.contactId] ?? ''} (${t(`resolution.exclusionReasons.${e.reason}`)})`).join(', ') : <Empty />],
            ])}
          </Section>
        </FormCardBody></FormCard>
        {details ? (
          <FormCard as="section"><FormCardBody>
            <Section title={t('resolution.details')}>{dl(Object.entries(details).map(([k, value]) => [t(`details.labels.${k}`), detailValue(k, value)]))}</Section>
          </FormCardBody></FormCard>
        ) : null}
        <FormCard as="section"><FormCardBody>
          <Section title={t('resolution.references')}>
            {dl([
              [t('resolution.statute'), statute ? <Link className={link} href={`/governance/statutes/${statute.id}`}>{t(`states.statute.${statute.state}`)}</Link> : <Empty />],
              [t('resolution.filings'), filings.length ? filings.map((f, i) => <span key={f.id}>{i > 0 ? ', ' : ''}<Link className={link} href={`/governance/register/${f.id}`}>{t(`states.registration.${f.state}`)}</Link></span>) : <Empty />],
              [t('resolution.minutes'), minutes ? <Link className={link} href={`/dms/${minutes.documentId}`}>{t('resolution.minutesSigned', { number: minutes.number ?? '', date: minutes.signedOn ? fmt.date(minutes.signedOn) : '' })}</Link> : row.source.kind === 'meeting' ? <Link className={link} href={`/governance/meetings/${row.source.meetingId}`}>{t('resolution.toMeeting')}</Link> : <Link className={link} href={`/governance/circulars/${row.source.circularId}`}>{t('resolution.toCircular')}</Link>],
              [t('resolution.followUps'), followUps.length ? followUps.map((f) => t('resolution.followUpLine', { title: f.title, date: fmt.date(f.dueAt), done: f.doneAt ? 'yes' : 'no' })).join('; ') : <Empty />],
              [t('resolution.usedBy'), usedBy.length ? usedBy.map((u) => (u.kind === 'reserve' ? t('resolution.usedByReserve', { name: u.label }) : u.kind === 'partnerPayment' ? (u.label ? t('resolution.usedByPartnerPayment', { number: u.label }) : t('resolution.usedByPartnerPaymentUnnumbered')) : t('resolution.usedByFeeSchedule', { date: fmt.date(u.label) }))).join('; ') : <Empty />],
              ...(r.kind === 'statute' || r.kind === 'purpose' ? ([[t('resolution.tax'), t('resolution.taxHint')]] as [string, React.ReactNode][]) : []),
            ])}
          </Section>
        </FormCardBody></FormCard>
        <RelatedDocuments deps={deps} ctx={ctx} entityType="governanceResolution" entityId={r.id} />
      </div>
    </Page>
  );
}
