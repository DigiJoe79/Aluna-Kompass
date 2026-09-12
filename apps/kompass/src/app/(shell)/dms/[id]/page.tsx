import { hasPermission, isModuleEnabled, listProjects, requirePermission, retentionEnd, retentionMonths, schema } from '@kompass/core';
import { listAnimals } from '@kompass/module-animals';
import { dispatchChannels, documentTypeFor, getDocumentRecord, listDocumentFolders } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { DocumentDetail } from './document-detail';
import { resolveLinks } from './links';

export default async function DocumentDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { deps, ctx } = await requireSession();
  const tCommon = await getTranslations('common');
  if (requirePermission(ctx, 'dms.view')) return <ForbiddenCard permission="dms.view" />;

  const { id } = await props.params;
  const result = await getDocumentRecord(deps, ctx, id);
  if (!result.ok) {
    notFound();
  }

  const doc = result.value;
  const docType = documentTypeFor(deps.db, doc.typeKey);
  const typeLabel = docType?.label ?? doc.typeKey;

  const today = deps.clock.now().toISOString().slice(0, 10);
  let retentionInfo: { retentionClass: string; until: string | null; due: boolean } | null = null;
  if (doc.phase === 'issued' && docType) {
    let until: string | null = null;
    if (docType.retentionClass !== 'permanent') {
      const months = retentionMonths(deps, docType.retentionClass);
      if (months !== null) {
        until = retentionEnd(doc.documentDate, months);
      }
    }
    retentionInfo = {
      retentionClass: docType.retentionClass,
      until,
      // Dauerhaft aufbewahrte Dokumente haben kein `until` und werden nie fällig.
      due: until !== null && until < today,
    };
  }

  const links = await resolveLinks(deps, ctx, doc.links);

  const foldersRes = await listDocumentFolders(deps, ctx);
  const folders = foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];

  // Nur, was dieser Betrachter auch verknüpfen dürfte: ein ausgeschaltetes
  // Modul und ein fehlendes Recht sehen gleich aus — die Art steht dann nicht
  // zur Wahl.
  const animalsRes =
    isModuleEnabled(deps, 'animals') && hasPermission(ctx, 'animals.view') ? await listAnimals(deps, ctx) : null;
  const animals = animalsRes?.ok ? animalsRes.value.map((a) => ({ id: a.id, name: a.name })) : [];
  const leading = deps.locales()[0] ?? 'de';
  const projectsRes = hasPermission(ctx, 'projects.view') ? await listProjects(deps, ctx) : null;
  const projects = projectsRes?.ok ? projectsRes.value.map((p) => ({ id: p.id, name: p.name[leading] || p.slug })) : [];

  /**
   * Die Namen der Kolleginnen sind keine Verwaltungsdaten: Ohne sie ließe sich
   * keine Zuständigkeit setzen und keine Notiz einem Menschen zuordnen. Die
   * Abfrage steht hier und nicht in einem Service, weil sie keinen Vorgang
   * abbildet.
   */
  const users = deps.db
    .select({ id: schema.users.id, name: schema.users.name, isActive: schema.users.isActive })
    .from(schema.users)
    .all()
    .filter((u) => u.isActive)
    .map((u) => ({ id: u.id, name: u.name }));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const canSeeFollowUps = hasPermission(ctx, 'followUps.view');
  const followUps = canSeeFollowUps
    ? doc.followUps.map((f) => ({
        id: f.id,
        dueAt: f.dueAt,
        title: f.title,
        assigneeName: f.assigneeUserId ? (nameOf.get(f.assigneeUserId) ?? null) : null,
        doneAt: f.doneAt,
      }))
    : [];

  const notes = doc.notes.map((note) => ({
    id: note.id,
    body: note.body,
    authorName: nameOf.get(note.createdByUserId) ?? note.createdByUserId,
    createdAt: note.createdAt,
    mine: note.createdByUserId === ctx.userId,
  }));

  const permissions = {
    canFile: hasPermission(ctx, 'dms.file'),
    canVoid: hasPermission(ctx, 'dms.void'),
    canDeleteDraft: hasPermission(ctx, 'dms.deleteDraft'),
    canEdit: hasPermission(ctx, 'dms.create'),
    canManage: hasPermission(ctx, 'dms.manage'),
  };

  return (
    <>
      <PageHeader title={doc.subject} back={{ href: '/dms', label: tCommon('backToList') }} />
      <DocumentDetail
        document={{
          id: doc.id,
          number: doc.number,
          subject: doc.subject,
          typeKey: doc.typeKey,
          typeLabel,
          documentDate: doc.documentDate,
          folder: doc.folder,
          direction: doc.direction,
          phase: doc.phase,
          status: doc.status,
          voidReason: doc.voidReason,
          voidedAt: doc.voidedAt,
          createdAt: doc.createdAt,
          textStatus: doc.textStatus,
          textExtractedAt: doc.textExtractedAt,
          textError: doc.textError,
          links,
          relations: doc.relations,
          sentAt: doc.sentAt,
          sentVia: doc.sentVia,
          sentNote: doc.sentNote,
        }}
        followUps={followUps}
        notes={notes}
        users={users}
        channels={dispatchChannels(deps)}
        today={today}
        canSeeFollowUps={canSeeFollowUps}
        canManageFollowUps={hasPermission(ctx, 'followUps.manage')}
        folders={folders}
        animals={animals}
        projects={projects}
        canCreateContact={hasPermission(ctx, 'contacts.manage')}
        retentionInfo={retentionInfo}
        permissions={permissions}
      />
    </>
  );
}
