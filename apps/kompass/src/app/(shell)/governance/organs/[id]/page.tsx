import { hasPermission, requirePermission, todayIn } from '@kompass/core';
import { getOrganDetail, listMeetings, TERM_END_REASONS } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { dateFormatOf } from '@/lib/date-format';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { requireSession } from '@/lib/request-context';
import { OfficeCreateButton } from './office-dialog';
import { OrganActions } from './organ-actions';
import { OrganForm } from './organ-form';
import { OrganLists } from './organ-lists';

/** Ein Organ (Stammdaten, Board 4b): die Seite ist das Formular, darunter Ämter und Amtsinhaber. */
export default async function OrganPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const { id } = await props.params;
  const t = await getTranslations('governance');
  const detail = await getOrganDetail(deps, ctx, { organId: id });
  if (!detail.ok) notFound();
  const { organ, representation, statuteId, terms } = detail.value;
  const fmt = dateFormatOf(deps);
  const manage = hasPermission(ctx, 'governance.manage');
  const activeOffices = organ.offices.filter((o) => o.active);
  const seats = activeOffices.reduce((n, o) => n + o.seats, 0);
  const filled = terms.filter((r) => r.running && activeOffices.some((o) => o.id === r.officeId)).length;
  const meetings = await listMeetings(deps, ctx, { organId: organ.id });
  const meetingNames = Object.fromEntries((meetings.ok ? meetings.value : []).map((m) => [m.id, meetingTitle((key, values) => t(key, values), fmt.date, m, organ.name)]));
  const repr = representation
    ? {
        value: [representation.value ? t(`representation.${representation.value.mode}`) : t('representation.majority'), representation.reference ?? representation.norm].filter(Boolean).join(' · '),
        href: statuteId ? `/governance/statutes/${statuteId}#rule-representation` : null,
      }
    : null;
  return (
    <Page
      width="standard"
      header={
        <PageHeader
          back={{ href: '/governance', label: t('overview.title') }}
          title={organ.name}
          description={t('organ.description', { filled, seats })}
          status={organ.active ? undefined : <StatusBadge tone="neutral">{t('organ.archived')}</StatusBadge>}
          actions={
            manage ? (
              <>
                <OfficeCreateButton organId={organ.id} others={organ.offices.map((o) => ({ id: o.id, name: o.name }))} />
                <OrganActions organId={organ.id} active={organ.active} required={organ.kind !== 'other'} />
              </>
            ) : undefined
          }
        />
      }
    >
      <OrganForm organ={{ id: organ.id, kind: organ.kind, name: organ.name }} representation={repr} />
      <OrganLists organId={organ.id} offices={organ.offices} terms={terms} meetingNames={meetingNames} manage={manage} today={todayIn(deps)} termEndReasons={TERM_END_REASONS} canPickDocuments={hasPermission(ctx, 'dms.view')} />
    </Page>
  );
}
