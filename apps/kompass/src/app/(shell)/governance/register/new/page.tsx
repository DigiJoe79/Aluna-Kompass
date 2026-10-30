import { requirePermission } from '@kompass/core';
import { listRegisterOccasions } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { FilingCreateForm } from './filing-create-form';

/** Anmeldung anlegen: offene Anlässe bündeln (vorgewählt alle). */
export default async function NewFilingPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.manage')) return <Page width="standard"><ForbiddenCard permission="governance.manage" /></Page>;
  const t = await getTranslations('governance');
  const occasions = await listRegisterOccasions(deps, ctx, {});
  if (!occasions.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const fmt = dateFormatOf(deps);
  return (
    <Page width="standard" header={<PageHeader back={{ href: '/governance/register', label: t('register.title') }} title={t('register.create')} />}>
      <FilingCreateForm occasions={occasions.value.map((o) => ({ ref: o.id ? { id: o.id } : o.termId ? { termId: o.termId } : { statuteId: o.statuteId! }, key: o.id ?? (o.termId ? `term:${o.termId}` : `statute:${o.statuteId}`), label: `${t(`register.occasions.${o.kind}`)} · ${fmt.date(o.occurredOn)}` }))} />
    </Page>
  );
}
