import { hasPermission, requirePermission, todayIn } from '@kompass/core';
import { getCircularContext, getOrganDetail } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { RelatedDocuments } from '@/components/related-documents';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { dateFormatOf } from '@/lib/date-format';
import { circularState } from '@/lib/governance/circular-state';
import { majorityText, ruleSource } from '@/lib/governance/majority-text';
import { requireSession } from '@/lib/request-context';
import { CircularView } from './circular-view';

/** Ein Umlauf (Board 7a). Das Dokument der Anfrage hängt über die Akte am Umlauf (Planprüfung Entscheidung 4). */
export default async function CircularPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const { id } = await props.params;
  const t = await getTranslations('governance');
  const tm = await getTranslations('governance.majority');
  const res = await getCircularContext(deps, ctx, { id });
  if (!res.ok) notFound();
  const c = res.value;
  const today = todayIn(deps);
  const fmt = dateFormatOf(deps);
  const state = circularState(c.circular, today);
  const title = (c.circular.text.split('\n').find((l) => l.trim()) ?? '').trim();
  const consent = c.circular.evaluation.consent;
  const ruleText = consent === 'all' ? t('circular.consentAll') : majorityText(tm, consent);
  const organDetail = await getOrganDetail(deps, ctx, { organId: c.organ.id });
  const chairOffice = organDetail.ok ? organDetail.value.organ.offices.find((o) => o.function === 'chair')?.id : undefined;
  const chairId = organDetail.ok ? (organDetail.value.terms.find((r) => r.running && r.officeId === chairOffice)?.contactId ?? null) : null;
  const organPhrase = c.organ.kind === 'board' ? t('circular.ofBoard') : t('circular.ofOrgan', { name: c.organ.name });
  return (
    <Page
      width="standard"
      header={
        <PageHeader
          back={{ href: '/governance/circulars', label: t('circulars.title') }}
          title={title}
          status={<StatusBadge tone={statusTone('circular', state)} dot>{t(`states.circular.${state}`, { date: fmt.date(c.circular.deadline) })}</StatusBadge>}
          description={t('circular.description', { organ: organPhrase, channel: t(`circular.channels.${c.circular.channel}`), requested: fmt.date(c.circular.requestedOn), deadline: fmt.date(c.circular.deadline) })}
        />
      }
    >
      <CircularView context={c} state={state} ruleText={ruleText} ruleRef={ruleSource(tm, c.rule)} detailsText={null} today={today} manage={hasPermission(ctx, 'governance.manage')} canPickDocuments={hasPermission(ctx, 'dms.view')} chairId={chairId} />
      <div className="mt-4">
        <RelatedDocuments deps={deps} ctx={ctx} entityType="governanceCircular" entityId={c.circular.id} />
      </div>
    </Page>
  );
}
