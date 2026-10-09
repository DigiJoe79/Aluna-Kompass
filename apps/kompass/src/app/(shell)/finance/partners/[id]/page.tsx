import { hasPermission } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { getPartner, listPartnerNotices, listPartnerPayments } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { requireSession } from '@/lib/request-context';
import { PartnerActions } from './partner-actions';
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
  if (!hasPermission(ctx, 'finance.read')) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
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

  const notices = noticesRes.ok ? noticesRes.value : [];
  const payments = paymentsRes.ok ? paymentsRes.value : [];
  const header = (
    <PageHeader
      title={partner.contactName}
      back={{ href: '/finance/partners', label: t('back') }}
      status={partner.isActive ? undefined : <StatusBadge tone="neutral">{t('actions.archived')}</StatusBadge>}
      actions={canWrite ? <PartnerActions id={partner.id} isActive={partner.isActive} deletable={payments.length === 0 && notices.length === 0} /> : undefined}
    />
  );

  return (
    <Page width="standard" header={header}>
      <PartnerDetail
        partner={partner}
        notices={notices}
        payments={payments.map((p) => ({ id: p.id, number: p.number, state: p.state, activeStep: p.activeStep, readyToAcknowledge: p.readyToAcknowledge, totalCents: p.totalCents, purposeText: p.purposeText, date: p.paidOn ?? p.approvedAt ?? p.submittedAt ?? p.createdAt }))}
        registerDocument={registerDocument}
        agreementDocument={agreementDocument}
        canWrite={canWrite}
      />
    </Page>
  );
}
