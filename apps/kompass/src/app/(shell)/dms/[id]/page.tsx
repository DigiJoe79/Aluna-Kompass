import { activeUserChoices, hasPermission, isModuleEnabled, readSetting, retentionEnd, retentionMonths, userNamesFor } from '@kompass/core';
import { listProjects } from '@kompass/module-projects';
import { listAnimals } from '@kompass/module-animals';
import { invoiceProposal } from '@kompass/module-finance';
import { dispatchChannels, documentTypeFor, getDocumentRecord, listDocumentFolders, listDocumentTypes, requireDmsGate } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InvoiceCard } from '@/components/finance/invoice-card';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { DocumentDetail } from './document-detail';
import { resolveLinks } from './links';

export default async function DocumentDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { deps, ctx } = await requireSession();
  const tCommon = await getTranslations('common');
  if (requireDmsGate(deps, ctx)) return <ForbiddenCard permission="dms.view" />;

  const { id } = await props.params;
  const result = await getDocumentRecord(deps, ctx, id);
  if (!result.ok) {
    if (result.error.type === 'forbidden') return <ForbiddenCard permission={result.error.permission} />;
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
   * keine Zuständigkeit setzen und keine Notiz einem Menschen zuordnen. Beides
   * kommt aus dem Kern (`users/names.ts`), ohne Rechteprüfung.
   */
  const users = activeUserChoices(deps);
  // Auch deaktivierte: Eine alte Notiz behält ihren Autor.
  const nameOf = userNamesFor(deps, [...doc.notes.map((n) => n.createdByUserId), ...doc.followUps.map((f) => f.assigneeUserId)]);

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

  // Umklassifizieren nur am abgelegten, nicht stornierten Eingang (Spec 2026-09-19).
  const canReclassify = doc.direction === 'incoming' && doc.phase === 'issued' && doc.status !== 'voided' && permissions.canEdit;
  const typesRes = canReclassify ? await listDocumentTypes(deps, ctx, { selectable: true }) : null;
  const reclassifyTypes = typesRes?.ok ? typesRes.value.map((type) => ({ key: type.key, label: type.label })) : null;

  // „Zu Buchung machen“ (Finanzen F5): ein Finanzbeleg, der noch an keiner Buchung hängt — nur, wer Buchungen vorbereiten darf.
  const canMakeEntry =
    isModuleEnabled(deps, 'finance') &&
    hasPermission(ctx, 'finance.entriesWrite') &&
    doc.phase === 'issued' &&
    doc.status !== 'voided' &&
    readSetting<string[]>(deps, 'finance.voucherTypes').includes(doc.typeKey) &&
    !doc.links.some((link) => link.entityType === 'financeEntry');
  const tWork = await getTranslations('finance.work');

  // „Aus der Rechnung“ (Finanzen F5b): nur an Finanzbelegen und nur mit `finance.read` — der Dienst prüft das Recht
  // ohnehin, die Bedingung spart nur das Lesen der Anhänge. Ohne Rechnung im PDF bleibt die Karte weg.
  const isFinanceVoucher = isModuleEnabled(deps, 'finance') && doc.phase === 'issued' && readSetting<string[]>(deps, 'finance.voucherTypes').includes(doc.typeKey);
  const proposalRes = isFinanceVoucher && hasPermission(ctx, 'finance.read') ? await invoiceProposal(deps, ctx, { documentId: doc.id }) : null;
  const invoicePanel =
    proposalRes?.ok && proposalRes.value.kind !== 'noInvoice' ? (
      <InvoiceCard documentId={doc.id} proposal={proposalRes.value} canWrite={hasPermission(ctx, 'finance.entriesWrite')} canCreateContact={hasPermission(ctx, 'contacts.manage')} />
    ) : null;

  return (
    <>
      <PageHeader
        title={doc.subject}
        back={{ href: '/dms', label: tCommon('backToList') }}
        actions={
          canMakeEntry ? (
            <Link href={`/finance/entries/new?voucher=${doc.id}`} className={buttonVariants({ size: 'sm' })}>
              {tWork('toEntry')}
            </Link>
          ) : undefined
        }
      />
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
          formerNumbers: doc.formerNumbers,
          updatedAt: doc.updatedAt,
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
        reclassifyTypes={reclassifyTypes}
        retentionInfo={retentionInfo}
        permissions={permissions}
        fileState={doc.fileState ?? 'none'}
        invoicePanel={invoicePanel}
      />
    </>
  );
}
