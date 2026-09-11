import { requirePermission } from '@kompass/core';
import { displayName, listContacts } from '@kompass/module-contacts';
import { defaultTypeKey, listDocumentFolders, listDocumentTypes } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { requireSession } from '@/lib/request-context';
import { DraftScreen } from './draft-screen';

export default async function NewDraftPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.create')) return <ForbiddenCard permission="dms.create" />;

  const t = await getTranslations('dms');
  const tCommon = await getTranslations('common');

  const typesRes = await listDocumentTypes(deps, ctx, { includeInactive: false });
  const types = typesRes.ok ? typesRes.value : [];

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
    <DraftScreen
      title={t('newDraft')}
      description={t('newDraftDescription')}
      back={{ href: '/dms', label: tCommon('backToList') }}
      types={types.map((type) => ({ key: type.key, label: type.label }))}
      folders={folders}
      contacts={contacts}
      today={deps.clock.now().toISOString().slice(0, 10)}
      defaultTypeKey={defaultTypeKey(deps, 'outgoing')}
    />
  );
}
