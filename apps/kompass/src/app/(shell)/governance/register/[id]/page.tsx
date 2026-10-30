import { hasPermission, requirePermission, todayIn } from '@kompass/core';
import { getFilingContext } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { dateFormatOf } from '@/lib/date-format';
import { filingSteps } from '@/lib/governance/filing-steps';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { requireSession } from '@/lib/request-context';
import { FilingWorkspace } from './filing-workspace';

/** Eine Registeranmeldung (Vorgang, Board 8b). */
export default async function FilingPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const { id } = await props.params;
  const t = await getTranslations('governance');
  const res = await getFilingContext(deps, ctx, { filingId: id });
  if (!res.ok) notFound();
  const c = res.value;
  const fmt = dateFormatOf(deps);
  const title = [...new Set(c.filing.occasions.map((o) => t(`register.occasions.${o.kind}`)))].join(t('register.and'));
  const first = c.occasions.find((o) => o.meetingKind && o.heldOn);
  const steps = filingSteps(c.filing, c.requirements);
  const doneCount = Object.values(steps.done).filter(Boolean).length;
  const description = [first?.meetingKind && first.heldOn ? t('register.forMeeting', { meeting: meetingTitle((k, v) => t(k, v), fmt.date, { kind: first.meetingKind, heldOn: first.heldOn }, '') }) : null, t('register.progress', { n: doneCount })].filter(Boolean).join(' ');
  return (
    <Page width="standard">
      <FilingWorkspace
        context={c}
        back={{ href: '/governance/register', label: t('register.title') }}
        title={title}
        description={description}
        manage={hasPermission(ctx, 'governance.manage')}
        today={todayIn(deps)}
        canPickContacts={hasPermission(ctx, 'contacts.view')}
        canPickDocuments={hasPermission(ctx, 'dms.view')}
      />
    </Page>
  );
}
