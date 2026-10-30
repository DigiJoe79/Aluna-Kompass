import { hasPermission, todayIn } from '@kompass/core';
import { getMeeting, getMeetingContext } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { dateFormatOf } from '@/lib/date-format';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { detailsOptionsFor } from '@/lib/governance/details-options';
import { requireSession } from '@/lib/request-context';
import { LiveWorkspace } from './live-workspace';

/**
 * Mitlauf (N1, Plan U1 Task 9, Board Gremien 1a–1i): Arbeitsfläche ohne Bereichsnavigation. Nur eine laufende Sitzung;
 * wer nicht schreibt, sieht lesend und kann die Protokollführung übernehmen.
 */
export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'governance.read')) return <Page width="full"><ForbiddenCard permission="governance.read" /></Page>;
  const [detail, context] = await Promise.all([getMeeting(deps, ctx, { id }), getMeetingContext(deps, ctx, { meetingId: id })]);
  if (!detail.ok || !context.ok) notFound();
  const t = await getTranslations('governance');
  const fmt = dateFormatOf(deps);
  const title = meetingTitle((key, values) => t(key, values), fmt.date, detail.value, context.value.organ.name);
  const back = { href: `/governance/meetings/${id}`, label: title };
  if (detail.value.state !== 'running') {
    return (
      <Page width="task" header={<PageHeader title={t('live.title')} back={back} />}>
        <div className="flex flex-col gap-3">
          <BlockedState step={t('live.blocked.step')} title={t('live.blocked.title')}>{t('live.blocked.text')}</BlockedState>
          <div>
            <Link href={back.href} className={buttonVariants({ variant: 'outline' })}>{t('live.blocked.toMeeting')}</Link>
          </div>
        </div>
      </Page>
    );
  }
  return (
    <Page width="full" header={<PageHeader title={t('live.title')} description={title} back={back} />}>
      <LiveWorkspace
        meeting={detail.value}
        context={context.value}
        title={title}
        today={todayIn(deps)}
        canRecord={hasPermission(ctx, 'governance.record')}
        canPickContacts={hasPermission(ctx, 'contacts.view')}
        detailsOptions={await detailsOptionsFor(deps, ctx, { on: detail.value.heldOn, fiscalYears: context.value.fiscalYears })}
      />
    </Page>
  );
}
