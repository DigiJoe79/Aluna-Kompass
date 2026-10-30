import { hasPermission, readSetting, requirePermission, todayIn } from '@kompass/core';
import { getGovernanceOverview } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { panelHref } from '@/components/panel-nav';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { dateFormatOf } from '@/lib/date-format';
import { deadlineValues } from '@/lib/governance/deadline-values';
import { meetingBadge, meetingTitle } from '@/lib/governance/meeting-state';
import { requireSession } from '@/lib/request-context';
import { OverviewOrganCard } from './overview-organ-card';

/**
 * Übersicht der Gremien (Board Phase 2 4a): je Organ eine Karte mit einer Zeile je Platz, rechts „Nächste Sitzung“ und
 * „Fristen“. Ab `lg` zwei Spalten, die rechte 320 px (Board).
 */
export default async function GovernanceOverviewPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const t = await getTranslations('governance');
  const tTiles = await getTranslations('dashboard.tiles.governance.deadlines.messages');
  const overview = await getGovernanceOverview(deps, ctx, {});
  if (!overview.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const o = overview.value;
  const fmt = dateFormatOf(deps);
  const today = todayIn(deps);
  const manage = hasPermission(ctx, 'governance.manage');
  const description = (
    <>
      {t('overview.description', { organs: o.organs.length, vacant: o.vacantSeats })}{' '}
      {o.statute?.since ? (
        <>
          {t('overview.statuteBefore')} <Link className="text-link underline-offset-2 hover:underline" href={`/governance/statutes/${o.statute.id}`}>{t('overview.statuteDate', { date: fmt.date(o.statute.since) })}</Link>.
        </>
      ) : null}
    </>
  );
  const header = (
    <PageHeader
      title={t('overview.title')}
      description={description}
      more={manage ? [{ key: 'organ', label: t('overview.createOrgan'), href: '/governance/organs/new' }] : []}
      actions={manage ? <Link href="/governance/meetings/new" className={buttonVariants()}>{t('overview.createMeeting')}</Link> : undefined}
    />
  );
  const next = o.nextMeeting;
  const nextBadge = next ? meetingBadge({ state: next.state, heldOn: next.heldOn, inviteBy: next.inviteBy }, today, readSetting<number>(deps, 'governance.deadlineLeadDays')) : null;
  return (
    <Page width="standard" header={header}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* G7: Regelwerk und Finanzen uneins, ob die MV die Jahresrechnung genehmigt — nur ein Hinweis, die Einstellung gehört den Finanzen. */}
          {o.accountsApprovalMismatch ? (
            <Notice level="warn" testId="governance-accounts-approval">
              {t(o.accountsApprovalMismatch.basis === 'resolution' ? 'overview.accountsApproval.resolutionYes' : o.accountsApprovalMismatch.statuteApproves ? 'overview.accountsApproval.statuteYes' : 'overview.accountsApproval.statuteNo')}{' '}
              {hasPermission(ctx, 'finance.setup') ? <Link className="text-link underline-offset-2 hover:underline" href={panelHref('/admin/finance', 'reports')}>{t('overview.accountsApproval.link')}</Link> : null}
            </Notice>
          ) : null}
          {o.rolesDiverge > 0 ? (
            <Notice level="warn">
              {t('overview.rolesDiverge', { count: o.rolesDiverge })}{' '}
              {manage ? <Link className="text-link underline-offset-2 hover:underline" href="/admin/governance">{t('overview.rolesDivergeLink')}</Link> : null}
            </Notice>
          ) : null}
          {o.organs.map((organ) => (
            <OverviewOrganCard
              key={organ.id}
              organ={{
                id: organ.id,
                kind: organ.kind,
                name: organ.name,
                lead:
                  organ.kind === 'board'
                    ? t('overview.boardLead', { rule: organ.representation?.value ? t(`representation.${organ.representation.value.mode}`) : t('representation.majority') })
                    : organ.kind === 'assembly'
                      ? t('overview.assemblyLead', { voting: organ.voting, last: organ.lastMeetingOn ? fmt.date(organ.lastMeetingOn) : 'none' })
                      : t('overview.otherLead', { holders: organ.voting }),
                seats: organ.seats,
              }}
              manage={manage}
              today={today}
              canPickContacts={hasPermission(ctx, 'contacts.view')}
              canPickDocuments={hasPermission(ctx, 'dms.view')}
            />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <FormCard as="section">
            <FormCardBody>
              <Section title={t('overview.next')}>
                {next ? (
                  <div className="flex flex-col gap-1 text-body">
                    <Link href={`/governance/meetings/${next.id}`} className="text-link underline-offset-2 hover:underline">
                      {meetingTitle((key, values) => t(key, values), fmt.date, next, next.organName)}
                    </Link>
                    <span className="text-meta text-muted-ink">{[fmt.date(next.heldOn), t('overview.at', { time: next.startsAt }), next.place].filter(Boolean).join(' · ')}</span>
                    {nextBadge ? (
                      <span>
                        <StatusBadge tone={statusTone('meeting', nextBadge.status)} dot>{t(`states.meeting.${nextBadge.status}`, { date: nextBadge.date ? fmt.date(nextBadge.date) : '' })}</StatusBadge>
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-meta text-muted-ink">{t('overview.noNext')}</p>
                )}
              </Section>
            </FormCardBody>
          </FormCard>
          <FormCard as="section">
            <FormCardBody>
              <Section title={t('overview.deadlines')}>
                {o.deadlines.length === 0 ? (
                  <p className="text-meta text-muted-ink">{t('overview.noDeadlines')}</p>
                ) : (
                  <ul className="flex flex-col">
                    {o.deadlines.map((d) => (
                      <li key={d.key} className="flex gap-3 border-b border-line-2 py-2 text-meta last:border-b-0">
                        <span className={`w-24 shrink-0 tabular-nums ${d.overdue ? 'text-warning' : 'text-muted-ink'}`}>{d.dueOn ? fmt.date(d.dueOn) : ''}</span>
                        {d.href ? (
                          <Link href={d.href} className="min-w-0 text-link underline-offset-2 hover:underline">{tTiles(d.kind, deadlineValues(d.params, fmt.date))}</Link>
                        ) : (
                          <span className="min-w-0">{tTiles(d.kind, deadlineValues(d.params, fmt.date))}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </FormCardBody>
          </FormCard>
        </div>
      </div>
    </Page>
  );
}
