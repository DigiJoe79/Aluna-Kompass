import { countUnfiledMediaAssets, listMediaAssets, listMediaFolders, mediaListFilterSchema, requirePermission, unwrap, userNamesFor } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { requireSession } from '@/lib/request-context';
import { LibraryClient } from './library-client';
import { capItems, type ListQuery } from './types';

type Params = { folder?: string; unfiled?: string; q?: string; kind?: string; sort?: string };

/** Unbekannte Werte fallen auf die Vorgabe zurück — eine getippte URL soll die Seite nie brechen. */
function readQuery(params: Params): ListQuery {
  const kind = params.kind === 'image' || params.kind === 'pdf' ? params.kind : 'all';
  const parsed = mediaListFilterSchema.safeParse({ sort: params.sort });
  const sort = parsed.success && parsed.data.sort ? parsed.data.sort : 'newest';
  const unfiled = params.unfiled === '1';
  return { folder: unfiled ? null : params.folder || null, unfiled, q: (params.q ?? '').trim().slice(0, 200), kind, sort };
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'media.upload')) return <ForbiddenCard permission="media.upload" />;
  const t = await getTranslations('media');
  const query = readQuery(await searchParams);

  const folders = unwrap(await listMediaFolders(deps, ctx));
  const listed = unwrap(
    await listMediaAssets(deps, ctx, {
      // Ein geöffneter Ordner zeigt seinen Teilbaum, „Ohne Ordner“ nur die losen Dateien.
      ...(query.unfiled ? { folder: null } : query.folder !== null ? { folder: query.folder, includeSubfolders: true } : {}),
      ...(query.q ? { query: query.q } : {}),
      ...(query.kind !== 'all' ? { kind: query.kind } : {}),
      sort: query.sort,
    }),
  );
  // Mehr als die Grenze schickt die Seite nicht an den Browser; der Satz unter der Liste sagt es.
  const { shown, matching } = capItems(listed);
  const names = userNamesFor(deps, shown.map((it) => it.record.uploadedByUserId));
  const items = shown.map((it) => ({
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

  // Die Zähler der festen Einträge: „Ohne Ordner“ zählt die losen Dateien, „Alle Dateien“ alles.
  const unfiledCount = unwrap(await countUnfiledMediaAssets(deps, ctx));
  const total = unfiledCount + folders.reduce((sum, f) => sum + f.assetCount, 0);

  return <LibraryClient title={t('title')} query={query} folders={folders} items={items} matching={matching} total={total} unfiledCount={unfiledCount} />;
}
