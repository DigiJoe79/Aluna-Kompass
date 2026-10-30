import { requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { OrganForm } from '../[id]/organ-form';

/** Ein weiteres Organ anlegen (Beirat, Ausschuss): nur der Name; die Art steht fest. */
export default async function NewOrganPage() {
  const { ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.manage')) return <Page width="standard"><ForbiddenCard permission="governance.manage" /></Page>;
  const t = await getTranslations('governance');
  return (
    <Page width="standard" header={<PageHeader back={{ href: '/governance', label: t('overview.title') }} title={t('organ.createTitle')} />}>
      <OrganForm organ={null} representation={null} />
    </Page>
  );
}
