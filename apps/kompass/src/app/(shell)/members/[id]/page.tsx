import { hasPermission, readLocales, readSetting, requirePermission, todayIn } from '@kompass/core';
import { feesForMembership, getMemberFeeDetail, getMembership, listMemberTypes, type DunningLevel } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { RelatedDocuments } from '@/components/related-documents';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { dateFormatOf } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { nameOrEmpty } from '@/lib/name-or-empty';
import { requireSession } from '@/lib/request-context';
import { EndNotice } from './end-notice';
import { FeeItemSheet } from './fee-item-sheet';
import { FeesTable } from './fees-table';
import { MemberForm } from './member-form';
import { MemberHeaderActions } from './member-header-actions';

/**
 * Mitglied (Handoff Mitglieder D1, 2.3, 3a–3f): Stammdaten nach dem Vorbild Partner, zweispaltig ab `xl` — links die
 * Formularkarte, rechts „Beiträge“ und die Briefe. Am Telefon das Standardmuster: Formular, dann die Nebenlisten (N3
 * abgelehnt). Der Kopf trägt eine Marke nur bei Abweichung.
 */
export default async function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ item?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'members.read')) return <Page width="standard"><ForbiddenCard permission="members.read" /></Page>;
  const { id } = await params;
  const { item } = await searchParams;
  const membership = await getMembership(deps, ctx, id);
  if (!membership.ok) notFound();
  const m = membership.value;
  const t = await getTranslations('members.detail');
  const nav = await getTranslations('nav');
  const fmt = dateFormatOf(deps);
  const [types, detail, fees] = await Promise.all([listMemberTypes(deps, ctx, { includeInactive: true }), getMemberFeeDetail(deps, ctx, m.id), feesForMembership(deps, ctx, m.id)]);
  if (!detail.ok) notFound();
  const leading = readLocales(deps)[0] ?? 'de';
  const typeRows = types.ok ? types.value.filter((ty) => ty.active || ty.id === m.typeId).map((ty) => ({ id: ty.id, name: nameOrEmpty(ty.name[leading], ty.key), exempt: ty.feeExempt })) : [];
  const typeName = typeRows.find((ty) => ty.id === m.typeId)?.name ?? '';
  const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels').map((l, i, all) => ({ key: l.key, name: nameOrEmpty(l.name[leading], l.key), last: i === all.length - 1 }));
  const today = todayIn(deps);

  const description =
    m.status === 'applied'
      ? t('subtitleApplication', { date: m.appliedOn ? fmt.date(m.appliedOn) : '', type: typeName })
      : m.memberNumber && m.joinedOn
        ? t('subtitle', { number: m.memberNumber, type: typeName, date: fmt.date(m.joinedOn) })
        : t('subtitlePlain', { number: m.memberNumber ?? '', type: typeName });
  const d = detail.value;
  const arrears = d.arrears;
  const mandateGone = d.paymentMethod === 'directDebit' && d.mandate && (d.mandate.state === 'expired' || d.mandate.state === 'ended');

  return (
    <Page
      width="standard"
      header={
        <PageHeader
          title={m.contactName}
          description={description}
          back={{ href: '/members', label: nav('members.list') }}
          status={m.status === 'active' ? undefined : <StatusBadge tone={statusTone('membership', m.status)} dot>{m.status === 'ending' && m.endsOn ? t('endsOn', { date: fmt.date(m.endsOn) }) : t(`status.${m.status}`)}</StatusBadge>}
          actions={<MemberHeaderActions membershipId={m.id} name={m.contactName} status={m.status} today={today} canManage={hasPermission(ctx, 'members.manage')} />}
        />
      }
    >
      <div className="space-y-6">
        {m.status === 'ending' && m.endsOn && m.endReason && hasPermission(ctx, 'members.manage') ? <EndNotice membershipId={m.id} end={{ endsOn: m.endsOn, reason: m.endReason, noticeOn: m.endNoticeOn }} /> : null}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
          <MemberForm
            m={{ id: m.id, status: m.status, contactId: m.contactId, contactName: m.contactName, memberNumber: m.memberNumber, appliedOn: m.appliedOn, admittedOn: m.admittedOn, typeId: m.typeId }}
            types={typeRows}
            detail={d}
            canManage={hasPermission(ctx, 'members.manage')}
            canFees={hasPermission(ctx, 'members.fees')}
            canOpenMandate={hasPermission(ctx, 'finance.read')}
            today={today}
          />
          <div className="space-y-6">
            {m.status === 'applied' || m.status === 'rejected' ? null : (
              <Section title={t('fees')}>
                <div className="space-y-3">
                  {arrears ? (
                    <Notice level="warn" title={t('arrears.title', { amount: formatEuro(arrears.openCents) })} testId="member-arrears">
                      {[
                        ...arrears.charges.map((c) => t('arrears.charge', { period: c.period, date: fmt.date(c.dueOn) })),
                        arrears.steps.length > 0 ? `${arrears.steps.map((s) => t('arrears.step', { level: s.levelName, date: fmt.date(s.sentOn) })).join(', ')}.` : null,
                        arrears.lastLevel ? t('arrears.last') : t('arrears.next'),
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    </Notice>
                  ) : null}
                  {mandateGone && d.mandate ? <Notice level="warn">{t('mandateExpired', { reference: d.mandate.reference })}</Notice> : null}
                  {fees.ok && fees.value.length > 0 ? (
                    <FeesTable fees={fees.value} levels={levels} canOpen={hasPermission(ctx, 'finance.read')} />
                  ) : (
                    <p className="text-meta text-muted-ink">{t('feesEmpty')}</p>
                  )}
                </div>
              </Section>
            )}
            <RelatedDocuments deps={deps} ctx={ctx} entityType="membership" entityId={m.id} />
            {m.status === 'applied' ? <p className="text-meta text-muted-ink">{t('applicationHint')}</p> : null}
          </div>
        </div>
      </div>
      {item ? <FeeItemSheet deps={deps} ctx={ctx} itemId={item} contactLabel={m.contactName} /> : null}
    </Page>
  );
}
