import { hasPermission, requirePermission } from '@kompass/core';
import { displayName, listContacts } from '@kompass/module-contacts';
import { defaultTypeKey, listDocumentFolders, listDocuments, listDocumentTypes } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { DocumentList, type DocumentListItem } from './document-list';
import { ReceiveDialog } from './receive/receive-dialog';

export interface DmsQuery {
  direction?: string;
  type?: string;
  folder?: string;
  phase?: string;
  inbox?: string;
  text?: string;
}

/**
 * Die Akte mit ihrer Liste — und darüber, wenn gewünscht, der Dialog zum
 * Ablegen. `/dms/receive` bleibt als Deep-Link bestehen und zeigt denselben
 * Bildschirm mit offenem Dialog: Wer den Link teilt, landet nicht auf einer
 * Seite, die es so nicht mehr gibt.
 */
export async function DmsView({ query, receive }: { query: DmsQuery; receive?: boolean }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.view')) return <ForbiddenCard permission="dms.view" />;

  const t = await getTranslations('dms');

  const typesRes = await listDocumentTypes(deps, ctx, { includeInactive: false });
  const types = typesRes.ok ? typesRes.value : [];
  const typesMap = new Map(types.map((type) => [type.key, type.label]));

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];

  const inboxRes = await listDocuments(deps, ctx, { inbox: true, limit: 1 });
  const inboxCount = inboxRes.ok ? inboxRes.value.total : 0;

  const isInbox = query.inbox === '1';
  const docsRes = await listDocuments(deps, ctx, {
    direction: query.direction === 'incoming' || query.direction === 'outgoing' ? query.direction : undefined,
    phase: query.phase === 'draft' || query.phase === 'issued' ? query.phase : undefined,
    typeKey: query.type || undefined,
    inbox: isInbox ? true : undefined,
    folder: isInbox ? undefined : query.folder || undefined,
    text: query.text || undefined,
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

  // Eingehende Arten zuerst: Wer Post ablegt, sucht sie oben.
  const incomingFirst = types
    .filter((type) => type.defaultDirection === 'incoming')
    .concat(types.filter((type) => type.defaultDirection !== 'incoming'))
    .map((type) => ({ key: type.key, label: type.label }));

  const contactsRes = canCreate ? await listContacts(deps, ctx, { limit: 200 }) : null;
  const contacts = contactsRes?.ok
    ? contactsRes.value.contacts.map((c) => ({ id: c.id, name: displayName(c) }))
    : [];

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
              <ReceiveDialog
                types={incomingFirst}
                folders={folders}
                contacts={contacts}
                defaultTypeKey={defaultTypeKey(deps, 'incoming')}
                defaultOpen={receive}
              />
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
