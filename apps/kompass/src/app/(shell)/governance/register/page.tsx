import { hasPermission, readSetting, requirePermission } from '@kompass/core';
import { getFilingContext, listRegisterFilings, listRegisterOccasions } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/components/section';
import { buttonVariants } from '@/components/ui/button';
import { dateFormatOf } from '@/lib/date-format';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { requireSession } from '@/lib/request-context';
import { FilingList, type FilingListRow } from './filing-list';

/** Register (Board 8a): offene Anlässe zum Anmelden, darunter die Anmeldungen. Kompass reicht nichts ein. */
export default async function RegisterPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const t = await getTranslations('governance');
  const [filings, occasions] = await Promise.all([listRegisterFilings(deps, ctx, {}), listRegisterOccasions(deps, ctx, {})]);
  if (!filings.ok || !occasions.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const fmt = dateFormatOf(deps);
  const manage = hasPermission(ctx, 'governance.manage');
  const number = readSetting<string>(deps, 'organization.registerNumber');
  const court = readSetting<string>(deps, 'organization.registerCourt');
  const create = manage ? <Link href="/governance/register/new" className={buttonVariants()}>{t('register.create')}</Link> : undefined;
  const header = <PageHeader title={t('register.title')} description={number ? t('register.lead', { number, court }) : t('register.leadNone')} actions={create} />;
  const rows: FilingListRow[] = [];
  for (const f of [...filings.value].reverse()) {
    const c = await getFilingContext(deps, ctx, { filingId: f.id });
    const first = c.ok ? c.value.occasions.find((o) => o.meetingKind) : undefined;
    rows.push({
      id: f.id,
      title: [...new Set(f.occasions.map((o) => t(`register.occasions.${o.kind}`)))].join(t('register.and')),
      meeting: first?.meetingKind && first.heldOn ? meetingTitle((k, v) => t(k, v), fmt.date, { kind: first.meetingKind, heldOn: first.heldOn }, '') : null,
      createdOn: f.createdAt,
      registeredOn: f.registeredOn,
      notary: c.ok ? (c.value.notary?.name ?? null) : null,
      state: f.state,
    });
  }
  return (
    <Page width="standard" header={header}>
      <div className="flex flex-col gap-4">
        {occasions.value.length > 0 ? (
          <FormCard as="section"><FormCardBody>
            <Section title={t('register.openOccasions')} actions={manage ? <Link href="/governance/register/new" className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('register.create')}</Link> : undefined}>
              <ul className="flex flex-col">
                {occasions.value.map((o) => (
                  <li key={o.id ?? (o.termId ? `term:${o.termId}` : `statute:${o.statuteId}`)} className="flex justify-between gap-3 border-b border-line-2 py-2 text-body last:border-b-0">
                    <span>{t(`register.occasions.${o.kind}`)}</span>
                    <span className="text-meta text-muted-ink">{fmt.date(o.occurredOn)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </FormCardBody></FormCard>
        ) : null}
        {rows.length === 0 ? <EmptyState title={t('register.emptyTitle')} text={t('register.emptyText')} /> : <FilingList rows={rows} />}
      </div>
    </Page>
  );
}
