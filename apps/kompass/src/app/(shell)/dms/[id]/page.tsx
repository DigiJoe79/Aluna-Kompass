import { hasPermission, requirePermission, retentionEnd, retentionMonths } from '@kompass/core';
import { documentTypeFor, getDocumentRecord } from '@kompass/module-dms';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { DocumentDetail } from './document-detail';

export default async function DocumentDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { deps, ctx } = await requireSession();
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

  const permissions = {
    canFile: hasPermission(ctx, 'dms.file'),
    canVoid: hasPermission(ctx, 'dms.void'),
    canDeleteDraft: hasPermission(ctx, 'dms.deleteDraft'),
    canEdit: hasPermission(ctx, 'dms.create'),
    canManage: hasPermission(ctx, 'dms.manage'),
  };

  return (
    <>
      <PageHeader title={doc.subject} />
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
          links: doc.links.map((l) => ({
            entityType: l.entityType,
            entityId: l.entityId,
            role: l.role,
          })),
        }}
        retentionInfo={retentionInfo}
        permissions={permissions}
      />
    </>
  );
}
