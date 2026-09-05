import { requirePermission } from '@kompass/core';
import { listDownloads } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { DownloadRow } from './download-row';

export default async function DownloadsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const t = await getTranslations('website.downloads');
  const result = await listDownloads(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="website.view" />;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <table className="w-full text-[14px]">
          <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.download')}</th><th className="px-4" colSpan={2}>{t('columns.fileAndTitle')}</th></tr></thead>
          <tbody>
            {result.value.map((d) => (
              <DownloadRow key={d.key} download={d} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
