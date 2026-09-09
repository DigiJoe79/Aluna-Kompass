import { listMediaAssets, listMediaFolders, requirePermission, unwrap } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { LibraryClient } from './library-client';

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'media.upload')) return <ForbiddenCard permission="media.upload" />;
  const t = await getTranslations('media');
  const { folder } = await searchParams;
  const current = folder ?? null;

  const folders = unwrap(await listMediaFolders(deps, ctx));
  const items = unwrap(await listMediaAssets(deps, ctx, current)).map((it) => ({
    id: it.record.id,
    filename: it.record.filename,
    mimeType: it.record.mimeType,
    bytes: it.record.bytes,
    createdAt: it.record.createdAt,
    references: it.references.map((r) => r.label),
  }));

  return (
    <>
      <PageHeader title={t('title')} />
      <LibraryClient current={current} folders={folders} items={items} />
    </>
  );
}
