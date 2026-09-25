import { hasPermission, readSetting, type LocalizedText } from '@kompass/core';
import { getApproval, listApprovals, listCategories, listPurposes, suggestExpenseCategories, waiverChecks, type ApprovalView } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { TransferBlock } from '@/components/finance/transfer-block';
import { Notice } from '@/components/notice';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { formatEuro } from '@/lib/finance/amount';
import { requireSession } from '@/lib/request-context';
import { cn } from '@/lib/utils';
import { ApprovalDetail } from './approval-detail';
import { ApprovalQueue, type QueueRow } from './approval-queue';

/**
 * D3 „Freigaben“ (F8a Task 6, Designer-README 3h): zweispaltig wie die Akte —
 * links die Warteschlange (älteste oben, nie die eigenen), rechts der gewählte
 * Antrag in der gemeinsamen Detailansicht. `?claim=` wählt; ohne Auswahl steht
 * die älteste rechts. Auf dem Telefon erst die Liste, nach der Wahl das Detail.
 * Nach der Entscheidung zeigt dieselbe Adresse das Ergebnis mit dem Sprung zum
 * nächsten Antrag.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ claim?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.approve')) return <ForbiddenCard permission="finance.approve" />;
  const t = await getTranslations('finance.approvals');
  const mode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const query = await searchParams;

  const queueRes = await listApprovals(deps, ctx, { limit: 200 });
  const items = queueRes.ok ? queueRes.value.items : [];
  const rows: QueueRow[] = items.map((i) => ({ claimId: i.claimId, number: i.number, kind: i.waiver ? 'waiver' : 'expenseClaim', person: i.contactName, amount: formatEuro(i.totalCents), since: formatDate(i.submittedAt, mode) }));
  const selectedId = query.claim ?? items[0]?.claimId ?? null;
  const nextId = items.find((i) => i.claimId !== selectedId)?.claimId ?? null;

  let detail: React.ReactNode = null;
  if (selectedId) {
    const approval = await getApproval(deps, ctx, { claimId: selectedId });
    if (!approval.ok) {
      if (approval.error.type === 'notFound') notFound();
      detail = (
        <div data-testid="approval-blocked">
          <BlockedState step={t('blocked.step')} title={t('blocked.title')}>
            {approval.error.type === 'conflict' ? approval.error.message : ''}
          </BlockedState>
        </div>
      );
    } else if (approval.value.state === 'submitted') {
      detail = <SubmittedDetail claim={approval.value} today={deps.clock.now().toISOString().slice(0, 10)} />;
    } else {
      detail = <Result claim={approval.value} nextId={nextId} />;
    }
  }

  return (
    <div>
      <PageHeader title={t('title')} description={t('intro')} />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        <div className={cn(query.claim && 'max-lg:hidden')}>
          <ApprovalQueue rows={rows} selectedId={selectedId} />
        </div>
        <div data-testid="approval-detail" className={cn('min-w-0 space-y-3', !query.claim && 'max-lg:hidden')}>
          {query.claim ? (
            <Link href="/finance/approvals" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-2 lg:hidden' })}>
              <span aria-hidden>←</span>
              {t('queue.back')}
            </Link>
          ) : null}
          {detail}
        </div>
      </div>
    </div>
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
            <TransferBlock recipient={claim.contactName} amountCents={claim.totalCents} reference={claim.number ?? ''} iban={claim.iban} />
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
