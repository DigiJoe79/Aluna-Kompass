import { requirePermission } from '@kompass/core';
import { displayName, listContacts } from '@kompass/module-contacts';
import { listDocumentFolders, listDocumentTypes } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ReceiveForm } from './receive-form';

export default async function ReceivePage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.create')) return <ForbiddenCard permission="dms.create" />;

  const t = await getTranslations('dms');

  const typesRes = await listDocumentTypes(deps, ctx, { includeInactive: false });
  const types = typesRes.ok
    ? typesRes.value
        .filter((t) => t.defaultDirection === 'incoming')
        .concat(typesRes.value.filter((t) => t.defaultDirection !== 'incoming'))
    : [];

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];

  const contactsRes = await listContacts(deps, ctx, { limit: 200 });
  const contacts = contactsRes.ok
    ? contactsRes.value.contacts.map((c) => ({
        id: c.id,
        name: displayName(c),
      }))
    : [];

  return (
    <>
      <PageHeader title={t('receivePost')} description={t('receiveDescription')} />
      <div className="max-w-[720px]">
        <ReceiveForm
          types={types.map((type) => ({ key: type.key, label: type.label }))}
          folders={folders}
          contacts={contacts}
        />
      </div>
    </>
  );
}
