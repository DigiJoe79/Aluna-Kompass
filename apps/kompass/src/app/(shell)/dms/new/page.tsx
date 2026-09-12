import { hasPermission, requirePermission } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { defaultTypeKey, listDocumentFolders, listDocumentTypes, listSnippets } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { requireSession } from '@/lib/request-context';
import { DraftScreen } from './draft-screen';

export default async function NewDraftPage(props: { searchParams: Promise<{ recipient?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.create')) return <ForbiddenCard permission="dms.create" />;

  const t = await getTranslations('dms');
  const tCommon = await getTranslations('common');

  const typesRes = await listDocumentTypes(deps, ctx, { includeInactive: false });
  const types = typesRes.ok ? typesRes.value : [];

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];

  // Von der Kontaktseite aus: Der Empfänger steht schon fest, und das Feld
  // sagt, woher er kommt.
  const { recipient: recipientId } = await props.searchParams;
  const recipientRes = recipientId ? await getContact(deps, ctx, recipientId) : null;
  const recipient = recipientRes?.ok ? { id: recipientRes.value.id, name: displayName(recipientRes.value) } : null;

  const snippetsRes = await listSnippets(deps, ctx, {});
  const snippets = snippetsRes.ok
    ? snippetsRes.value.map((s) => ({ id: s.id, name: s.name, subject: s.subject, body: s.body }))
    : [];

  return (
    <DraftScreen
      title={t('newDraft')}
      description={t('newDraftDescription')}
      back={{ href: '/dms', label: tCommon('backToList') }}
      types={types.map((type) => ({ key: type.key, label: type.label }))}
      folders={folders}
      canCreateContact={hasPermission(ctx, 'contacts.manage')}
      snippets={snippets}
      initialRecipient={recipient}
      recipientOrigin={recipient ? t('suggest.fromContactPage') : undefined}
      today={deps.clock.now().toISOString().slice(0, 10)}
      defaultTypeKey={defaultTypeKey(deps, 'outgoing')}
    />
  );
}
