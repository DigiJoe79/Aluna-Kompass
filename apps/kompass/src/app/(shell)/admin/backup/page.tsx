import { hasPermission, readSetting, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { runtimeEnv } from '@/lib/deps';
import { environmentConfirmationName } from '@/lib/env-banner';
import { requireSession } from '@/lib/request-context';
import { ExportCard } from './export-card';
import { ImportCard } from './import-card';
import { MaxAgeSettings } from './max-age-settings';

export default async function BackupPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'backup.export')) return <Page width="standard"><ForbiddenCard permission="backup.export" /></Page>;
  const t = await getTranslations('backup');
  return (
    <Page width="standard" header={<PageHeader title={t('title')} />}>
      <div className="flex flex-col gap-5">
        <ExportCard lastExportAt={readSetting<string | null>(deps, 'system.lastExportAt')} />
        <MaxAgeSettings maxAgeDays={readSetting<number>(deps, 'backup.maxAgeDays')} canManage={hasPermission(ctx, 'settings.manage')} />
        {requirePermission(ctx, 'backup.import') ? null : <ImportCard environmentName={environmentConfirmationName(runtimeEnv().env)} />}
      </div>
    </Page>
  );
}