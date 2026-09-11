import { hasPermission, requirePermission } from '@kompass/core';
import { listDocumentFolders, listDocuments, listDocumentTypes } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { DocumentList, type DocumentListItem } from './document-list';

export default async function DmsPage(props: {
  searchParams: Promise<{
    direction?: string;
    type?: string;
    folder?: string;
    phase?: string;
    inbox?: string;
    text?: string;
  }>;
}) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.view')) return <ForbiddenCard permission="dms.view" />;

  const t = await getTranslations('dms');
  const q = await props.searchParams;

  const typesRes = await listDocumentTypes(deps, ctx, { includeInactive: false });
  const types = typesRes.ok ? typesRes.value : [];
  const typesMap = new Map(types.map((type) => [type.key, type.label]));

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];

  const inboxRes = await listDocuments(deps, ctx, { inbox: true, limit: 1 });
  const inboxCount = inboxRes.ok ? inboxRes.value.total : 0;

  const isInbox = q.inbox === '1';
  const docsRes = await listDocuments(deps, ctx, {
    direction: q.direction === 'incoming' || q.direction === 'outgoing' ? q.direction : undefined,
    phase: q.phase === 'draft' || q.phase === 'issued' ? q.phase : undefined,
    typeKey: q.type || undefined,
    inbox: isInbox ? true : undefined,
    folder: isInbox ? undefined : (q.folder || undefined),
    text: q.text || undefined,
    limit: 200,
  });

  if (!docsRes.ok) return <ForbiddenCard permission="dms.view" />;

  const rows: DocumentListItem[] = docsRes.value.documents.map((d) => ({
    id: d.id,
    number: d.number,
    subject: d.subject,
    typeKey: d.typeKey,
    typeLabel: typesMap.get(d.typeKey) ?? d.typeKey,
    documentDate: d.documentDate,
    folder: d.folder,
    direction: d.direction,
    phase: d.phase,
    status: d.status,
    textStatus: d.textStatus,
  }));

  const canCreate = hasPermission(ctx, 'dms.create');

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate ? (
            <>
              <Link href="/dms/new" className={buttonVariants({ variant: 'default', size: 'sm' })}>
                {t('newDraft')}
              </Link>
              <Link href="/dms/receive" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('receivePost')}
              </Link>
            </>
          ) : null
        }
      />
      <DocumentList
        documents={rows}
        types={types.map((type) => ({ key: type.key, label: type.label }))}
        folders={folders}
        inboxCount={inboxCount}
        hits={docsRes.value.hits}
        fulltextTooShort={docsRes.value.fulltextTooShort}
      />
    </>
  );
}
