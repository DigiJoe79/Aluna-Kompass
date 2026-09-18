import { listMediaAssets, listMediaFolders, mediaListFilterSchema, requirePermission, schema, unwrap } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { LibraryClient } from './library-client';
import type { ListQuery } from './types';

type Params = { folder?: string; q?: string; kind?: string; sort?: string };

/** Unbekannte Werte fallen auf die Vorgabe zurück — eine getippte URL soll die Seite nie brechen. */
function readQuery(params: Params): ListQuery {
  const kind = params.kind === 'image' || params.kind === 'pdf' ? params.kind : 'all';
  const parsed = mediaListFilterSchema.safeParse({ sort: params.sort });
  const sort = parsed.success && parsed.data.sort ? parsed.data.sort : 'newest';
  return { folder: params.folder ?? null, q: (params.q ?? '').trim().slice(0, 200), kind, sort };
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'media.upload')) return <ForbiddenCard permission="media.upload" />;
  const t = await getTranslations('media');
  const query = readQuery(await searchParams);

  const names = new Map(deps.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).all().map((u) => [u.id, u.name]));
  const folders = unwrap(await listMediaFolders(deps, ctx));
  const items = unwrap(
    await listMediaAssets(deps, ctx, {
      ...(query.folder !== null ? { folder: query.folder } : {}),
      ...(query.q ? { query: query.q } : {}),
      ...(query.kind !== 'all' ? { kind: query.kind } : {}),
      sort: query.sort,
    }),
  ).map((it) => ({
    id: it.record.id,
    filename: it.record.filename,
    mimeType: it.record.mimeType,
    bytes: it.record.bytes,
    width: it.record.width,
    height: it.record.height,
    createdAt: it.record.createdAt,
    uploadedBy: it.record.uploadedByUserId ? (names.get(it.record.uploadedByUserId) ?? null) : null,
    folder: it.record.folder,
    references: it.references.map((r) => (r.href ? { label: r.label, href: r.href } : { label: r.label })),
  }));

  return (
    <>
      <PageHeader title={t('title')} />
      <LibraryClient query={query} folders={folders} items={items} />
    </>
  );
}
