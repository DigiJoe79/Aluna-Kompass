import { hasPermission, requirePermission, type CallContext, type Deps } from '@kompass/core';
import { getProject } from '@kompass/module-projects';
import { getAnimal } from '@kompass/module-animals';
import { displayName, getContact } from '@kompass/module-contacts';
import {
  countDocumentsByFolder,
  defaultTypeKey,
  listDocumentFolders,
  listDocuments,
  listDocumentTypes,
} from '@kompass/module-dms';
import { ForbiddenCard } from '@/components/forbidden-card';
import { requireSession } from '@/lib/request-context';
import { DmsWorkspace } from './dms-workspace';
import { DocumentList, type DocumentListItem } from './document-list';
import { readSort } from '@/lib/sort';

/**
 * Der Name hinter `about=<typ>:<id>` — dieselben drei Typen wie in
 * `dms/[id]/links.ts`, nur ohne den Weg dorthin.
 */
async function labelFor(deps: Deps, ctx: CallContext, entityType: string, entityId: string): Promise<string> {
  if (entityType === 'contact') {
    const res = await getContact(deps, ctx, entityId);
    return res.ok ? displayName(res.value) : entityId;
  }
  if (entityType === 'animal') {
    const res = await getAnimal(deps, ctx, entityId);
    return res.ok ? res.value.name : entityId;
  }
  const res = await getProject(deps, ctx, entityId);
  const leading = deps.locales()[0] ?? 'de';
  return res.ok ? res.value.name[leading] || res.value.slug : entityId;
}

export interface DmsQuery {
  direction?: string;
  type?: string;
  folder?: string;
  phase?: string;
  inbox?: string;
  text?: string;
  sort?: string;
  dir?: string;
  unsent?: string;
  followUp?: string;
  /** Von der Kontaktseite: der Absender steht schon fest. */
  sender?: string;
  /** Von der Seite eines Bezugs: `<entityType>:<entityId>`. */
  about?: string;
}

/** Die Spalten, nach denen die Liste sortieren darf — mehr nimmt der Service nicht. */
const SORTABLE = ['number', 'subject', 'documentDate', 'typeKey', 'folder', 'createdAt'] as const;

/**
 * Die Akte mit ihrer Liste — und darüber, wenn gewünscht, der Dialog zum
 * Ablegen. `/dms/receive` bleibt als Deep-Link bestehen und zeigt denselben
 * Bildschirm mit offenem Dialog: Wer den Link teilt, landet nicht auf einer
 * Seite, die es so nicht mehr gibt.
 */
export async function DmsView({ query, receive }: { query: DmsQuery; receive?: boolean }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.view')) return <ForbiddenCard permission="dms.view" />;

  const typesRes = await listDocumentTypes(deps, ctx, { includeInactive: false });
  const types = typesRes.ok ? typesRes.value : [];
  const typesMap = new Map(types.map((type) => [type.key, type.label]));

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];

  const inboxRes = await listDocuments(deps, ctx, { inbox: true, limit: 1 });
  const inboxCount = inboxRes.ok ? inboxRes.value.total : 0;

  const allRes = await listDocuments(deps, ctx, { limit: 1 });
  const total = allRes.ok ? allRes.value.total : 0;

  const countsRes = await countDocumentsByFolder(deps, ctx);
  const counts = countsRes.ok ? countsRes.value : {};

  const isInbox = query.inbox === '1';
  const docsRes = await listDocuments(deps, ctx, {
    direction: query.direction === 'incoming' || query.direction === 'outgoing' ? query.direction : undefined,
    phase: query.phase === 'draft' || query.phase === 'issued' ? query.phase : undefined,
    typeKey: query.type || undefined,
    inbox: isInbox ? true : undefined,
    folder: isInbox ? undefined : query.folder || undefined,
    text: query.text || undefined,
    unsent: query.unsent === '1' ? true : undefined,
    withOpenFollowUp: query.followUp === 'open' ? true : undefined,
    orderBy: readSort(query, SORTABLE),
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
    sentAt: d.sentAt,
    openFollowUp: d.followUps.find((f) => !f.doneAt) ?? null,
  }));

  const canCreate = hasPermission(ctx, 'dms.create');

  // Vorbelegungen aus der Adresszeile: Wer von einer Kontakt-, Tier- oder
  // Projektseite kommt, findet den Bezug schon gesetzt.
  const senderRes = query.sender ? await getContact(deps, ctx, query.sender) : null;
  const initialSender = senderRes?.ok ? { id: senderRes.value.id, name: displayName(senderRes.value) } : null;

  const [aboutType, aboutId] = (query.about ?? '').split(':');
  const initialAbout =
    aboutType && aboutId && ['contact', 'animal', 'project'].includes(aboutType)
      ? { entityType: aboutType, entityId: aboutId, label: await labelFor(deps, ctx, aboutType, aboutId) }
      : null;

  // Eingehende Arten zuerst: Wer Post ablegt, sucht sie oben.
  const incomingFirst = types
    .filter((type) => type.defaultDirection === 'incoming')
    .concat(types.filter((type) => type.defaultDirection !== 'incoming'))
    .map((type) => ({ key: type.key, label: type.label }));


  return (
    <DmsWorkspace
      folders={folders}
      counts={counts}
      inboxCount={inboxCount}
      total={total}
      canCreate={canCreate}
      types={incomingFirst}
      canCreateContact={hasPermission(ctx, 'contacts.manage')}
      defaultTypeKey={defaultTypeKey(deps, 'incoming')}
      initialSender={initialSender}
      initialAbout={initialAbout}
      receiveOpen={receive || Boolean(initialSender) || Boolean(initialAbout)}
    >
      <DocumentList
        documents={rows}
        types={types.map((type) => ({ key: type.key, label: type.label }))}
        folders={folders}
        inboxCount={inboxCount}
        today={deps.clock.now().toISOString().slice(0, 10)}
        canMove={canCreate}
        hits={docsRes.value.hits}
        fulltextTooShort={docsRes.value.fulltextTooShort}
      />
    </DmsWorkspace>
  );
}
