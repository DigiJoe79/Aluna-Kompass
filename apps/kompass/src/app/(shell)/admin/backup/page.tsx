import { readSetting, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { runtimeEnv } from '@/lib/deps';
import { environmentConfirmationName } from '@/lib/env-banner';
import { requireSession } from '@/lib/request-context';
import { ExportCard } from './export-card';
import { ImportCard } from './import-card';

export default async function BackupPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'backup.export')) return <ForbiddenCard permission="backup.export" />;
  const t = await getTranslations('backup');
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex max-w-[880px] flex-col gap-5">
        <ExportCard lastExportAt={readSetting<string | null>(deps, 'system.lastExportAt')} />
        {requirePermission(ctx, 'backup.import') ? null : <ImportCard environmentName={environmentConfirmationName(runtimeEnv().env)} />}
      </div>
    </>
  );
}