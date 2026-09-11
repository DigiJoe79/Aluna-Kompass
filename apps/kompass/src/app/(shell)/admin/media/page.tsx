import { listMediaAssets, listMediaFolders, requirePermission, schema, unwrap } from '@kompass/core';
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
  // `current === null` ist die Ansicht „Alle Dateien“ (Filter aus).
  const current = folder ?? null;

  const names = new Map(deps.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).all().map((u) => [u.id, u.name]));
  const folders = unwrap(await listMediaFolders(deps, ctx));
  const items = unwrap(await listMediaAssets(deps, ctx, current ?? undefined)).map((it) => ({
    id: it.record.id,
    filename: it.record.filename,
    mimeType: it.record.mimeType,
    bytes: it.record.bytes,
    width: it.record.width,
    height: it.record.height,
    createdAt: it.record.createdAt,
    uploadedBy: it.record.uploadedByUserId ? (names.get(it.record.uploadedByUserId) ?? null) : null,
    folder: it.record.folder,
    references: it.references.map((r) => r.label),
  }));

  return (
    <>
      <PageHeader title={t('title')} />
      <LibraryClient current={current} folders={folders} items={items} />
    </>
  );
}
