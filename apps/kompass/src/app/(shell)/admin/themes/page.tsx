import { listThemes, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ThemeEditor } from './theme-editor';

export default async function ThemesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'settings.manage')) return <Page width="standard"><ForbiddenCard permission="settings.manage" /></Page>;
  const t = await getTranslations('themes');
  const { themes, activeKey } = listThemes(deps);
  return (
    <Page width="standard" header={<PageHeader title={t('title')} />}>
      <ThemeEditor themes={themes} activeKey={activeKey} />
    </Page>
  );
}
