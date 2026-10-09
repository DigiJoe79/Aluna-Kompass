import { yearIn, hasPermission, todayIn, type CallContext, type Deps } from '@kompass/core';
import { getProject } from '@kompass/module-projects';
import { getAnimal } from '@kompass/module-animals';
import { displayName, getContact } from '@kompass/module-contacts';
import {
  defaultTypeKey,
  listDocumentFolders,
  listDocuments,
  listDocumentTypes,
  requireDmsGate,
} from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { FiledAnnouncement } from './filed-announcement';
import { Notice } from '@/components/notice';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ancestorsOf, nameOf } from '@/lib/folder-tree-model';
import { requireSession } from '@/lib/request-context';
import { DmsWorkspace } from './dms-workspace';
import { DocumentList, type DocumentListItem } from './document-list';
import { FolderHeading } from './folder-heading';
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
  /** Nach dem Ablegen in eine geschützte Art: die Nummer, die das Dokument bekam. */
  filed?: string;
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
  if (requireDmsGate(deps, ctx)) return <ForbiddenCard permission="dms.view" />;

  const [typesRes, selectableTypesRes] = await Promise.all([
    listDocumentTypes(deps, ctx, { includeInactive: false }),
    listDocumentTypes(deps, ctx, { selectable: true }),
  ]);
  const types = typesRes.ok ? typesRes.value : [];
  const selectableTypes = selectableTypesRes.ok ? selectableTypesRes.value : [];
  const typesMap = new Map(types.map((type) => [type.key, type.label]));

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => ({ path: f.path, count: f.count })) : [];
  const folderPaths = folders.map((f) => f.path);

  const inboxRes = await listDocuments(deps, ctx, { inbox: true, limit: 1 });
  const inboxCount = inboxRes.ok ? inboxRes.value.total : 0;

  const allRes = await listDocuments(deps, ctx, { limit: 1 });
  const total = allRes.ok ? allRes.value.total : 0;

  const isInbox = query.inbox === '1';
  // Ein Ordner aus der Adresse, den es nicht mehr gibt (von anderer Hand
  // verschoben, alter Link): der nächste vorhandene Vorfahr mit Hinweis, ohne
  // ihn „Alle Dokumente“ (Spec § 5.3). Vorfahren zählen mit, auch wenn sie nur
  // als Weg bestehen — der Baum zeigt sie ebenso.
  const known = new Set(folderPaths.flatMap((path) => [...ancestorsOf(path), path]));
  const requestedFolder = isInbox ? null : query.folder || null;
  const folderGone = requestedFolder !== null && !known.has(requestedFolder);
  const currentFolder = folderGone ? (ancestorsOf(requestedFolder).reverse().find((path) => known.has(path)) ?? null) : requestedFolder;
  const docsRes = await listDocuments(deps, ctx, {
    direction: query.direction === 'incoming' || query.direction === 'outgoing' ? query.direction : undefined,
    phase: query.phase === 'draft' || query.phase === 'issued' ? query.phase : undefined,
    typeKey: query.type || undefined,
    inbox: isInbox ? true : undefined,
    folder: currentFolder ?? undefined,
    // Ein geöffneter Ordner zeigt seinen ganzen Teilbaum: Zahl im Baum und Länge der Liste stimmen überein (Spec § 9).
    includeSubfolders: currentFolder !== null,
    text: query.text || undefined,
    unsent: query.unsent === '1' ? true : undefined,
    withOpenFollowUp: query.followUp === 'open' ? true : undefined,
    orderBy: readSort(query, SORTABLE),
    limit: 200,
  });

  if (!docsRes.ok) return <ForbiddenCard permission="dms.view" />;
  // „{Treffer} von {alle}“ in der Zählzeile: „alle“ meint den Ort (Ordner mit Teilbaum, Eingangskorb, alles) ohne Filter.
  const filtered = Boolean(query.text || query.direction || query.type || query.phase || query.unsent === '1' || query.followUp === 'open');
  const placeRes = filtered
    ? await listDocuments(deps, ctx, { inbox: isInbox ? true : undefined, folder: currentFolder ?? undefined, includeSubfolders: currentFolder !== null, limit: 1 })
    : docsRes;
  const unfiltered = placeRes.ok ? placeRes.value.total : docsRes.value.total;

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
  const canExport = hasPermission(ctx, 'documents.export');
  const currentYear = yearIn(deps);

  // Nach dem Ablegen in eine geschützte Art: die Nummer, sonst nichts. Sie kommt
  // aus der Adresszeile und wird deshalb nur ausgegeben, wenn sie wie eine aussieht.
  const t = await getTranslations('dms');
  const filedNumber = query.filed && /^[A-Z]{3}-\d{4}-\d+$/.test(query.filed) ? query.filed : null;

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
  const incomingFirst = selectableTypes
    .filter((type) => type.defaultDirection === 'incoming')
    .concat(selectableTypes.filter((type) => type.defaultDirection !== 'incoming'))
    .map((type) => ({ key: type.key, label: type.label }));


  return (
    <DmsWorkspace
      folders={folders}
      inboxCount={inboxCount}
      total={total}
      canCreate={canCreate}
      canManage={hasPermission(ctx, 'dms.manage')}
      areaOnly={!hasPermission(ctx, 'dms.view')}
      canExport={canExport}
      currentFolder={currentFolder}
      currentYear={currentYear}
      types={incomingFirst}
      canCreateContact={hasPermission(ctx, 'contacts.manage')}
      defaultTypeKey={defaultTypeKey(deps, 'incoming')}
      initialSender={initialSender}
      initialAbout={initialAbout}
      receiveOpen={receive || Boolean(initialSender) || Boolean(initialAbout)}
    >
      {filedNumber ? (
        <div className="mb-3">
          <FiledAnnouncement message={t('filedToast', { number: filedNumber })} number={filedNumber} />
          <Notice level="hint" testId="filed-protected">
            {t('filedProtected', { number: filedNumber })}
          </Notice>
        </div>
      ) : null}
      {folderGone ? (
        <div className="mb-3">
          <Notice level="hint" testId="folder-gone">
            {currentFolder === null
              ? t('folderGoneAll', { name: nameOf(requestedFolder) })
              : t('folderGone', { name: nameOf(requestedFolder), target: nameOf(currentFolder) })}
          </Notice>
        </div>
      ) : null}
      <FolderHeading
        folder={currentFolder}
        inbox={isInbox}
        keep={new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))}
        className="max-sm:hidden"
      />
      <DocumentList
        documents={rows}
        currentFolder={currentFolder}
        total={docsRes.value.total}
        unfiltered={unfiltered}
        readableOnly={!hasPermission(ctx, 'dms.view')}
        types={types.map((type) => ({ key: type.key, label: type.label }))}
        folders={folderPaths}
        inboxCount={inboxCount}
        today={todayIn(deps)}
        canMove={canCreate}
        hits={docsRes.value.hits}
        fulltextTooShort={docsRes.value.fulltextTooShort}
      />
    </DmsWorkspace>
  );
}
