import { hasPermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { PartnerCreateForm } from './partner-create-form';

/**
 * Partner anlegen auf einer eigenen Seite wie bei allen Stammdaten (MUSTER.md § C):
 * ein Kontakt, der Status — alles Weitere pflegt die Detailseite. Anlegen
 * verlangt `finance.entriesWrite`, wie der Dienst.
 */
export default async function NewPartnerPage() {
  const { ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;
  if (!hasPermission(ctx, 'finance.entriesWrite')) return <Page width="task"><ForbiddenCard permission="finance.entriesWrite" /></Page>;
  const t = await getTranslations('finance.partners.list');
  const c = await getTranslations('common');
  return (
    <Page width="task" header={<PageHeader title={t('create.title')} back={{ href: '/finance/partners', label: c('backToList') }} />}>
      <PartnerCreateForm />
    </Page>
  );
}
