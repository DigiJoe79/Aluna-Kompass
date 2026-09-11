import { hasPermission, requirePermission, retentionEnd, retentionMonths } from '@kompass/core';
import { documentTypeFor, getDocumentRecord } from '@kompass/module-dms';
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
        }}
        retentionInfo={retentionInfo}
        permissions={permissions}
      />
    </>
  );
}
