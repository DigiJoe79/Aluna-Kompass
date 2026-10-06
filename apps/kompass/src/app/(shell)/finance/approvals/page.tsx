import { hasPermission, readSetting, todayIn, userNamesFor, type LocalizedText } from '@kompass/core';
import { epcQrPayload, getApproval, getPartnerPayment, getPurposeTransfer, listApprovals, listEvidence, listCategories, listPurposes, suggestExpenseCategories, waiverChecks, type ApprovalQueueItem, type ApprovalView } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { TransferBlock } from '@/components/finance/transfer-block';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { formatEuro } from '@/lib/finance/amount';
import { requireSession } from '@/lib/request-context';
import { cn } from '@/lib/utils';
import { ApprovalDetail } from './approval-detail';
import { ApprovalQueue, type QueueRow } from './approval-queue';
import { PartnerPaymentDetail } from './partner-payment-detail';
import { PurposeTransferDetail } from './purpose-transfer-detail';
import { conflictText } from '@/lib/error-text';

/**
 * D3 „Freigaben“ (F8a Task 6, Designer-README 3h): zweispaltig wie die Akte —
 * links die Warteschlange (älteste oben, nie die eigenen), rechts der gewählte
 * Antrag in der gemeinsamen Detailansicht. `?claim=` wählt; ohne Auswahl steht
 * die älteste rechts. Auf dem Telefon erst die Liste, nach der Wahl das Detail.
 * Nach der Entscheidung zeigt dieselbe Adresse das Ergebnis mit dem Sprung zum
 * nächsten Antrag.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ claim?: string; payment?: string; transfer?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.approve')) return <Page width="full"><ForbiddenCard permission="finance.approve" /></Page>;
  const t = await getTranslations('finance.approvals');
  const mode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const query = await searchParams;

  const queueRes = await listApprovals(deps, ctx, { limit: 200 });
  const queueItems: ApprovalQueueItem[] = queueRes.ok ? queueRes.value.items : [];
  const isExpenseClaim = (i: ApprovalQueueItem): i is Extract<ApprovalQueueItem, { kind: 'expenseClaim' }> => i.kind === 'expenseClaim';
  const isPartnerPayment = (i: ApprovalQueueItem): i is Extract<ApprovalQueueItem, { kind: 'partnerPayment' }> => i.kind === 'partnerPayment';
  const isPurposeTransfer = (i: ApprovalQueueItem): i is Extract<ApprovalQueueItem, { kind: 'purposeTransfer' }> => i.kind === 'purposeTransfer';
  // F7 Task 4/6b, F8b Task 3 (Annahme 5/6): die Warteschlange ist polymorph — erst vereint, dann sortiert (`listApprovals`); hier nur die Zeilen bauen.
  const rows: QueueRow[] = queueItems.map((i) => {
    if (isPartnerPayment(i)) return { id: i.paymentId, href: `/finance/approvals?payment=${i.paymentId}`, number: '', kind: 'partnerPayment', person: i.partnerName, amount: formatEuro(i.totalCents), since: formatDate(i.submittedAt, mode) };
    if (isPurposeTransfer(i)) {
      const person = `${i.fromName ?? t('transfer.freeFunds')} → ${i.toName ?? t('transfer.freeFunds')}`;
      return { id: i.transferId, href: `/finance/approvals?transfer=${i.transferId}`, number: i.number, kind: 'purposeTransfer', person, amount: formatEuro(i.amountCents), since: formatDate(i.submittedAt, mode) };
    }
    return { id: i.claimId, href: `/finance/approvals?claim=${i.claimId}`, number: i.number, kind: i.waiver ? 'waiver' : 'expenseClaim', person: i.contactName, amount: formatEuro(i.totalCents), since: formatDate(i.submittedAt, mode) };
  });
  // Nach einer Entscheidung steht die Zeile nicht mehr in `rows` (sie hat die Warteschlange verlassen) — `?claim=`/`?payment=`/`?transfer=`
  // bleiben trotzdem die gewählte Art: `getApproval`/`getPartnerPayment`/`getPurposeTransfer` liefern den Vorgang unabhängig vom Zustand.
  const selectedId = query.claim ?? query.payment ?? query.transfer ?? rows[0]?.id ?? null;
  const selectedKind = query.claim ? 'expenseClaim' : query.payment ? 'partnerPayment' : query.transfer ? 'purposeTransfer' : rows[0]?.kind ?? null;
  const nextRow = rows.find((r) => r.id !== selectedId);

  let detail: React.ReactNode = null;
  if (selectedId && selectedKind === 'partnerPayment') {
    const paymentRes = await getPartnerPayment(deps, ctx, { id: selectedId });
    if (!paymentRes.ok) notFound();
    const evidenceRes = await listEvidence(deps, ctx, { paymentId: selectedId });
    const creatorName = userNamesFor(deps, [paymentRes.value.createdByUserId]).get(paymentRes.value.createdByUserId) ?? '—';
    detail = (
      <PartnerPaymentDetail
        payment={paymentRes.value}
        creatorName={creatorName}
        evidence={(evidenceRes.ok ? evidenceRes.value : []).map((e) => ({ kind: e.kind, documentId: e.documentId, foreignLanguage: e.foreignLanguage, explanationDe: e.explanationDe, coveredCents: e.coveredCents }))}
        nextHref={nextRow?.href ?? null}
      />
    );
  } else if (selectedId && selectedKind === 'purposeTransfer') {
    const transferRes = await getPurposeTransfer(deps, ctx, { id: selectedId });
    if (!transferRes.ok) notFound();
    const creatorName = userNamesFor(deps, [transferRes.value.createdByUserId]).get(transferRes.value.createdByUserId) ?? '—';
    detail = <PurposeTransferDetail transfer={transferRes.value} creatorName={creatorName} nextHref={nextRow?.href ?? null} />;
  } else if (selectedId) {
    const approval = await getApproval(deps, ctx, { claimId: selectedId });
    if (!approval.ok) {
      if (approval.error.type === 'notFound') notFound();
      detail = (
        <div data-testid="approval-blocked">
          <BlockedState step={t('blocked.step')} title={t('blocked.title')}>
            {approval.error.type === 'conflict' ? conflictText(approval.error, await getTranslations()) : ''}
          </BlockedState>
        </div>
      );
    } else if (approval.value.state === 'submitted') {
      detail = <SubmittedDetail claim={approval.value} today={todayIn(deps)} />;
    } else {
      detail = <Result claim={approval.value} nextId={nextRow?.kind === 'expenseClaim' || nextRow?.kind === 'waiver' ? nextRow.id : null} />;
    }
  }

  const header = <PageHeader title={t('title')} description={t('intro')} />;
  // Leere Schlange, nichts gewählt: nur der leere Zustand, ohne Spalten und ohne Überschrift der Schlange (K9-Befund 7).
  if (!selectedId) {
    return (
      <Page width="full" header={header}>
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      </Page>
    );
  }

  // Jede der drei Arten zählt als Wahl — sonst zeigt das Telefon bei `?transfer=` die Schlange statt der Umwidmung (K9-Befund 12).
  const activeQuery = query.claim || query.payment || query.transfer;
  // Nach der letzten Entscheidung ist die Schlange leer, der Vorgang aber noch gewählt: dann nur die Detailspalte.
  const withQueue = rows.length > 0;
  return (
    <Page width="full" header={header}>
      <div className={cn('grid gap-5', withQueue && 'lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start')}>
        {withQueue ? (
          <div className={cn(activeQuery && 'max-lg:hidden')}>
            <ApprovalQueue rows={rows} selectedId={selectedId} />
          </div>
        ) : null}
        <div data-testid="approval-detail" className={cn('min-w-0 space-y-3', withQueue && !activeQuery && 'max-lg:hidden')}>
          {activeQuery ? (
            <Link href="/finance/approvals" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-2 lg:hidden' })}>
              <span aria-hidden>←</span>
              {t('queue.back')}
            </Link>
          ) : null}
          {detail}
        </div>
      </div>
    </Page>
  );

  /** Ein eingereichter Antrag: Kategorien, Zwecke, Projektnamen, Vorschläge und — bei Verzicht — die vier Prüfungen laden. */
  async function SubmittedDetail({ claim, today }: { claim: ApprovalView; today: string }) {
    const [categoriesRes, purposesRes, suggestionsRes, checksRes] = await Promise.all([
      listCategories(deps, ctx, {}),
      listPurposes(deps, ctx, {}),
      suggestExpenseCategories(deps, ctx, { claimId: claim.id }),
      claim.waiver ? waiverChecks(deps, ctx, { claimId: claim.id }) : Promise.resolve(null),
    ]);
    const categories = (categoriesRes.ok ? categoriesRes.value : [])
      .filter((c) => c.direction === 'expense')
      .map((c) => ({ id: c.id, name: c.name, sphere: c.sphere ?? 'ideal', explanation: c.explanation || undefined }));
    const purposes = (purposesRes.ok ? purposesRes.value : []).map((p) => ({ id: p.id, name: p.name }));
    const leading = deps.locales()[0] ?? 'de';
    const projectsRes = hasPermission(ctx, 'projects.view') ? await listProjects(deps, ctx) : null;
    const projects = Object.fromEntries((projectsRes?.ok ? projectsRes.value : []).map((p) => [p.id, (p.name as LocalizedText)[leading] || p.slug]));
    return (
      <ApprovalDetail
        key={claim.id}
        claim={claim}
        categories={categories}
        purposes={purposes}
        projects={projects}
        suggestions={suggestionsRes.ok ? suggestionsRes.value : []}
        checks={checksRes?.ok ? checksRes.value : null}
        today={today}
      />
    );
  }

  /** Nach der Entscheidung: Badge, was entstanden ist (Überweisungsdaten bzw. Buchung), und der Sprung zum nächsten Antrag. */
  async function Result({ claim, nextId }: { claim: ApprovalView; nextId: string | null }) {
    const tState = await getTranslations('finance.expenses.state');
    const approved = claim.state === 'approved';
    return (
      <section data-testid="approval-result" aria-live="polite" className="space-y-4 rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[15px] font-semibold">{claim.number}</span>
          <StatusBadge tone={approved ? 'success' : 'neutral'}>{approved ? t('result.approved') : t('result.rejected')}</StatusBadge>
          {claim.stateLabelKey === 'paid' ? <StatusBadge tone="final">{tState('paid')}</StatusBadge> : null}
        </div>
        <p className="font-mono text-[26px] font-semibold tabular-nums">{formatEuro(claim.totalCents)}</p>
        <p className="text-[14px] text-ink">{claim.contactName}</p>
        {approved && claim.openItemId ? (
          <div className="space-y-2">
            <Notice level="hint">{t('result.payable')}</Notice>
            <TransferBlock
              recipient={claim.contactName}
              amountCents={claim.totalCents}
              reference={claim.number ?? ''}
              iban={claim.iban}
              epcPayload={epcQrPayload({ recipient: claim.contactName, iban: claim.iban ?? '', amountCents: claim.totalCents, reference: claim.number ?? '' })}
            />
            <Link href="/finance/open-items" className="text-[13px] underline underline-offset-2 hover:text-link">
              {t('result.openItems')}
            </Link>
          </div>
        ) : null}
        {approved && claim.entryId ? (
          <div className="space-y-2">
            <Notice level="hint">{t('result.waiver')}</Notice>
            <Link href={`/finance/entries/${claim.entryId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('result.entry')}
            </Link>
          </div>
        ) : null}
        {!approved ? <p className="text-[14px] text-ink-2">{t('result.rejectedText', { note: claim.rejectNote ?? '' })}</p> : null}
        <div className="border-t border-line pt-3">
          {nextId ? (
            <Link href={`/finance/approvals?claim=${nextId}`} className={buttonVariants({ variant: 'default' })}>
              {t('result.next')}
            </Link>
          ) : (
            <p className="text-[13px] text-muted-ink">{t('result.none')}</p>
          )}
        </div>
      </section>
    );
  }
}
