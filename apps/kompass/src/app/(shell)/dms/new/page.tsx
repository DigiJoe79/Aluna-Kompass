import { hasPermission, requirePermission, todayIn } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { defaultTypeKey, listDocumentFolders, listDocumentTypes, listSnippets } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { requireSession } from '@/lib/request-context';
import { DraftScreen } from './draft-screen';

export default async function NewDraftPage(props: { searchParams: Promise<{ recipient?: string; folder?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.create')) return <Page width="full"><ForbiddenCard permission="dms.create" /></Page>;

  const t = await getTranslations('dms');
  const tCommon = await getTranslations('common');

  const typesRes = await listDocumentTypes(deps, ctx, { selectable: true });
  const types = typesRes.ok ? typesRes.value : [];

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => ({ path: f.path, count: f.count })) : [];

  // Von der Kontaktseite aus: Der Empfänger steht schon fest, und das Feld
  // sagt, woher er kommt.
  const { recipient: recipientId, folder: requestedFolder } = await props.searchParams;
  // Vom geöffneten Ordner der Akte: nur übernehmen, was es gibt, sonst bleibt das Feld leer.
  const initialFolder = requestedFolder && folders.some((f) => f.path === requestedFolder) ? requestedFolder : null;
  const recipientRes = recipientId ? await getContact(deps, ctx, recipientId) : null;
  const recipient = recipientRes?.ok ? { id: recipientRes.value.id, name: displayName(recipientRes.value) } : null;

  const snippetsRes = await listSnippets(deps, ctx, {});
  const snippets = snippetsRes.ok
    ? snippetsRes.value.map((s) => ({ id: s.id, name: s.name, subject: s.subject, body: s.body }))
    : [];

  // Papiervorschau neben der Maske: eine Arbeitsfläche, darum `full` (Handoff Konsistenz § 8c).
  return (
    <Page width="full">
      <DraftScreen
        title={t('newDraft')}
        description={t('newDraftDescription')}
        back={{ href: '/dms', label: tCommon('backToList') }}
        types={types.map((type) => ({ key: type.key, label: type.label }))}
        folders={folders}
        initialFolder={initialFolder}
        canCreateContact={hasPermission(ctx, 'contacts.manage')}
        snippets={snippets}
        initialRecipient={recipient}
        recipientOrigin={recipient ? t('suggest.fromContactPage') : undefined}
        today={todayIn(deps)}
        defaultTypeKey={defaultTypeKey(deps, 'outgoing')}
      />
    </Page>
  );
}
