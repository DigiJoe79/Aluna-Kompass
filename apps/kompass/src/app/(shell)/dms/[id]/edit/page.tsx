import { hasPermission, requirePermission } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { defaultTypeKey, getDocumentRecord, listDocumentFolders, listDocumentTypes } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { requireSession } from '@/lib/request-context';
import { DraftScreen } from '../../new/draft-screen';

export default async function EditDraftPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.create')) return <ForbiddenCard permission="dms.create" />;

  const { id } = await props.params;
  const result = await getDocumentRecord(deps, ctx, id);
  if (!result.ok) notFound();

  // Festgeschrieben heißt unveränderlich — dorthin führt nur noch die Stornierung.
  if (result.value.phase !== 'draft') notFound();

  const t = await getTranslations('dms');

  const typesRes = await listDocumentTypes(deps, ctx, { includeInactive: false });
  const types = typesRes.ok ? typesRes.value : [];

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];

  const doc = result.value;
  const recipientLink = doc.links.find((link) => link.role === 'recipient' && link.entityType === 'contact');
  // Nur der gewählte Kontakt wird aufgelöst; gesucht wird im Feld selbst.
  const recipientRes = recipientLink ? await getContact(deps, ctx, recipientLink.entityId) : null;
  const recipient = recipientRes?.ok ? { id: recipientRes.value.id, name: displayName(recipientRes.value) } : null;

  return (
    <DraftScreen
      title={t('editDraft')}
      description={t('editDraftDescription')}
      back={{ href: `/dms/${id}`, label: t('backToDocument') }}
      types={types.map((type) => ({ key: type.key, label: type.label }))}
      folders={folders}
      canCreateContact={hasPermission(ctx, 'contacts.manage')}
      today={deps.clock.now().toISOString().slice(0, 10)}
      defaultTypeKey={defaultTypeKey(deps, 'outgoing')}
      draft={{
        id: doc.id,
        subject: doc.subject,
        body: doc.draftBody ?? '',
        typeKey: doc.typeKey,
        documentDate: doc.documentDate,
        folder: doc.folder,
        recipient,
        savedAt: doc.updatedAt,
      }}
    />
  );
}
