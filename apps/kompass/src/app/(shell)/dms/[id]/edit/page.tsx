import { requirePermission } from '@kompass/core';
import { displayName, listContacts } from '@kompass/module-contacts';
import { defaultTypeKey, getDocumentRecord, listDocumentFolders, listDocumentTypes } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { DraftForm } from '../../new/draft-form';

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

  const contactsRes = await listContacts(deps, ctx, { limit: 200 });
  const contacts = contactsRes.ok
    ? contactsRes.value.contacts.map((c) => ({ id: c.id, name: displayName(c) }))
    : [];

  const doc = result.value;
  const recipient = doc.links.find((link) => link.role === 'recipient' && link.entityType === 'contact');

  return (
    <>
      <PageHeader title={t('editDraft')} description={t('editDraftDescription')} back={{ href: `/dms/${id}`, label: t('backToDocument') }} />
      <div className="max-w-[720px]">
        <DraftForm
          types={types.map((type) => ({ key: type.key, label: type.label }))}
          folders={folders}
          contacts={contacts}
          today={deps.clock.now().toISOString().slice(0, 10)}
          defaultTypeKey={defaultTypeKey(deps, 'outgoing')}
          draft={{
            id: doc.id,
            subject: doc.subject,
            body: doc.draftBody ?? '',
            typeKey: doc.typeKey,
            documentDate: doc.documentDate,
            folder: doc.folder,
            recipientId: recipient?.entityId ?? null,
          }}
        />
      </div>
    </>
  );
}
