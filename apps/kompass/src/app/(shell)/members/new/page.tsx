import { readLocales, requirePermission, todayIn } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { listFeeSchedules, listMemberTypes } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { nameOrEmpty } from '@/lib/name-or-empty';
import { requireSession } from '@/lib/request-context';
import { MemberCreateForm } from './member-create-form';

/** Mitglied anlegen (Handoff Mitglieder 2.2): `standard`; `?contact=` belegt den Kontakt vor (Kontaktseite, 8c). */
export default async function NewMemberPage({ searchParams }: { searchParams: Promise<{ contact?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'members.manage')) return <Page width="standard"><ForbiddenCard permission="members.manage" /></Page>;
  const t = await getTranslations('members.form');
  const nav = await getTranslations('nav');
  const { contact } = await searchParams;
  const [types, schedules, picked] = await Promise.all([
    listMemberTypes(deps, ctx, {}),
    listFeeSchedules(deps, ctx, {}),
    contact ? getContact(deps, ctx, contact) : Promise.resolve(null),
  ]);
  if (!types.ok) return <Page width="standard"><ForbiddenCard permission="members.read" /></Page>;
  const leading = readLocales(deps)[0] ?? 'de';
  return (
    <Page width="standard" header={<PageHeader title={t('createTitle')} back={{ href: '/members', label: nav('members.list') }} />}>
      <MemberCreateForm
        types={types.value.map((ty) => ({ id: ty.id, name: nameOrEmpty(ty.name[leading], ty.key), exempt: ty.feeExempt }))}
        schedules={schedules.ok ? schedules.value.map((s) => ({ validFrom: s.validFrom, rules: s.rules.map((r) => ({ typeId: r.typeId, amountCents: r.amountCents, interval: r.interval })) })) : []}
        initialContact={picked?.ok ? { id: picked.value.id, name: displayName(picked.value) } : null}
        today={todayIn(deps)}
      />
    </Page>
  );
}
