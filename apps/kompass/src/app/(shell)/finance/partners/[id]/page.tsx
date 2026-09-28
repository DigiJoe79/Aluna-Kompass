import { hasPermission } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { getPartner, listPartnerNotices, listPartnerPayments } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { PartnerDetail, type PartnerDocument } from './partner-detail';

/**
 * E1 Detail (F7 Task 6b, Design-Nachtrag Phase 4): zweispaltig ab `lg` —
 * links die Angaben zum Partner, rechts seine Bescheide (deutsche Bescheide
 * bei `taxExemptBody`, die Anerkennung im Sitzland bei `foreignBody`) und
 * seine Zahlungen. Anlegen einer neuen Zahlung entsteht
 * hier als leerer Entwurf, den die Seite sofort öffnet.
 */
export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.partners.detail');

  const partnerRes = await getPartner(deps, ctx, { id });
  if (!partnerRes.ok || !partnerRes.value) notFound();
  const partner = partnerRes.value;

  const noticesRes = await listPartnerNotices(deps, ctx, { partnerId: id });
  const paymentsRes = await listPartnerPayments(deps, ctx, { partnerId: id });
  const canWrite = hasPermission(ctx, 'finance.entriesWrite');
  // Nummer und Betreff nur, wenn die Akte sie dieser Person zeigt (D5) — sonst bleibt es bei „hinterlegt“.
  const document = async (documentId: string | null): Promise<PartnerDocument | null> => {
    if (!documentId) return null;
    const record = await getDocumentRecord(deps, ctx, documentId);
    return record.ok ? { id: documentId, number: record.value.number, subject: record.value.subject, phase: record.value.phase } : { id: documentId, hidden: true };
  };
  const [registerDocument, agreementDocument] = await Promise.all([document(partner.registerDocumentId), document(partner.agreementDocumentId)]);

  return (
    <div className="max-w-[1200px] space-y-2">
      <PageHeader title={partner.contactName} back={{ href: '/finance/partners', label: t('back') }} />
      <PartnerDetail
        partner={partner}
        notices={noticesRes.ok ? noticesRes.value : []}
        payments={(paymentsRes.ok ? paymentsRes.value : []).map((p) => ({ id: p.id, number: p.number, state: p.state, activeStep: p.activeStep, readyToAcknowledge: p.readyToAcknowledge, totalCents: p.totalCents, purposeText: p.purposeText, date: p.paidOn ?? p.approvedAt ?? p.submittedAt ?? p.createdAt }))}
        registerDocument={registerDocument}
        agreementDocument={agreementDocument}
        canWrite={canWrite}
      />
    </div>
  );
}
