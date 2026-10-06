import { hasPermission, listUserNamesWithPermission, todayIn, userNamesFor, type LocalizedText } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { getPartner, getPartnerPayment, listCategories, listEligibleLines, listEvidence, listPurposes } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { PaymentDetail } from './payment-detail';

/**
 * E2 (F7 Task 6b): Entwurf mit Positionen und — bei nachträglicher Freigabe —
 * gewählten Zeilen; nach dem Einreichen die Vorgangsansicht mit
 * Nachweisen. Kategorien, Projekte und Kandidatenzeilen liest die Seite
 * einmal serverseitig, statt sie im Client zu suchen (Zeitbudget — kein
 * Suchfeld wie `DocumentPicker`, siehe Befundliste).
 */
export default async function PartnerPaymentPage({ params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.partners.payment');
  const tState = await getTranslations('finance.partners.detail.payments.state');

  const paymentRes = await getPartnerPayment(deps, ctx, { id: paymentId });
  if (!paymentRes.ok || paymentRes.value.partnerId !== id) notFound();
  const payment = paymentRes.value;

  const partnerRes = await getPartner(deps, ctx, { id });
  if (!partnerRes.ok || !partnerRes.value) notFound();
  const partner = partnerRes.value;

  const canWrite = hasPermission(ctx, 'finance.entriesWrite');
  const categoriesRes = await listCategories(deps, ctx, { includeInactive: false });
  const categories = (categoriesRes.ok ? categoriesRes.value : []).filter((c) => c.direction === 'expense');
  const purposesRes = await listPurposes(deps, ctx, {});
  const purposes = purposesRes.ok ? purposesRes.value : [];
  const projectsRes = hasPermission(ctx, 'projects.view') ? await listProjects(deps, ctx) : null;
  const projects = projectsRes?.ok ? projectsRes.value : [];

  let paidLineOptions: { id: string; entryNumber: string | null; entryDate: string; amountCents: number }[] = [];
  let goodsLineOptions: { id: string; entryNumber: string | null; entryDate: string; amountCents: number; categoryId: string }[] = [];
  if (payment.state === 'draft' && canWrite) {
    const paidRes = await listEligibleLines(deps, ctx, { partnerId: id, kind: 'paidLine' });
    if (paidRes.ok) paidLineOptions = paidRes.value;
    const goodsRes = await listEligibleLines(deps, ctx, { partnerId: id, kind: 'goodsLine' });
    if (goodsRes.ok) goodsLineOptions = goodsRes.value;
  }

  // Der Picker startet mit Nummer und Betreff des Dokuments, soweit die Akte es dieser Person zeigt.
  const agreementRecord = payment.agreementDocumentId ? await getDocumentRecord(deps, ctx, payment.agreementDocumentId) : null;
  const agreementDocument = payment.agreementDocumentId
    ? agreementRecord?.ok
      ? { id: payment.agreementDocumentId, number: agreementRecord.value.number, subject: agreementRecord.value.subject, phase: agreementRecord.value.phase }
      : { id: payment.agreementDocumentId, number: null, subject: '', phase: 'issued' as const }
    : null;

  const evidenceRes = payment.state !== 'draft' ? await listEvidence(deps, ctx, { paymentId }) : null;
  const evidence = evidenceRes?.ok ? evidenceRes.value : [];
  // Nummer und Betreff der Nachweise, soweit die Akte sie dieser Person zeigt (Artboard 4b: „B-2026-0231 · Überweisung“).
  const evidenceDocs = new Map(
    await Promise.all(
      [...new Set(evidence.map((e) => e.documentId).filter((id): id is string => !!id))].map(async (id) => {
        const record = await getDocumentRecord(deps, ctx, id);
        return [id, record.ok ? { number: record.value.number, subject: record.value.subject } : null] as const;
      }),
    ),
  );
  const names = userNamesFor(deps, [payment.createdByUserId, payment.approvedByUserId, payment.acknowledgedByUserId]);
  const creatorName = names.get(payment.createdByUserId) ?? '';
  // Wer anerkennen kann (Annahme 7): Recht „Freigeben“, nie die Person, die den Vorgang angelegt hat.
  const acknowledgers = listUserNamesWithPermission(deps, 'finance.approve').filter((name) => name !== creatorName);

  return (
    <Page
      width="task"
      header={
        <PageHeader
          title={t('heading', { label: payment.number ?? tState(payment.state) })}
          description={partner.contactName}
          back={{ href: `/finance/partners/${id}`, label: t('back') }}
        />
      }
    >
      <PaymentDetail
        payment={payment}
        partner={partner}
        canWrite={canWrite && !payment.acknowledgedAt}
        canApprove={hasPermission(ctx, 'finance.approve')}
        categories={categories.map((c) => ({ id: c.id, label: c.name }))}
        purposes={purposes.map((p) => ({ id: p.id, label: p.name }))}
        projects={projects.map((p) => ({ id: p.id, name: (p.name as LocalizedText)[deps.locales()[0] ?? 'de'] || p.slug }))}
        paidLineOptions={paidLineOptions}
        goodsLineOptions={goodsLineOptions}
        agreementDocument={agreementDocument}
        today={todayIn(deps)}
        evidence={evidence.map((e) => ({ id: e.id, kind: e.kind, documentId: e.documentId, foreignLanguage: e.foreignLanguage, explanationDe: e.explanationDe, coveredCents: e.coveredCents, document: e.documentId ? evidenceDocs.get(e.documentId) ?? null : null }))}
        people={{ creator: creatorName, approver: payment.approvedByUserId ? names.get(payment.approvedByUserId) ?? null : null, acknowledger: payment.acknowledgedByUserId ? names.get(payment.acknowledgedByUserId) ?? null : null, acknowledgers, viewerIsCreator: ctx.userId === payment.createdByUserId }}
      />
    </Page>
  );
}
