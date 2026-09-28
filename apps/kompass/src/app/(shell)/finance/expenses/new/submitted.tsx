import { readSetting } from '@kompass/core';
import type { ExpenseClaimView } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { formatDateTime, type DateFormatMode } from '@/lib/dates';
import { formatEuro } from '@/lib/finance/amount';
import { requireSession } from '@/lib/request-context';

/**
 * „Eingereicht“ als eigene Seite statt eines Toasts (Designer-README 3a):
 * Betrag, Nummer, Zeitpunkt, Positionen und wer freigeben kann. Die Liste der
 * Freigebenden kommt aus dem Dienst — ohne die Person, die angelegt hat, und
 * ohne die antragstellende.
 */
export async function SubmittedView({ claim }: { claim: ExpenseClaimView }) {
  const { deps } = await requireSession();
  const t = await getTranslations('finance.expenses.submitted');
  const mode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  return (
    <section data-testid="expense-submitted" aria-labelledby="expense-submitted-title" className="max-w-[640px] space-y-5">
      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 id="expense-submitted-title" className="font-heading text-[22px]">
          {t('title')}
        </h2>
        <p className="mt-1 text-[14px] text-ink-2">{t('text', { number: claim.number ?? '', at: formatDateTime(claim.submittedAt, mode) })}</p>
        <p className="mt-4 text-[13px] text-muted-ink">{t('amount')}</p>
        <p className="font-mono text-[34px] font-semibold tabular-nums">{formatEuro(claim.totalCents)}</p>
        {claim.waiver ? <p className="mt-1 text-[14px] text-ink-2">{t('waiver')}</p> : null}
      </div>

      <div className="rounded-lg border border-line bg-surface p-5">
        <h3 className="mb-2 text-[13px] font-semibold text-muted-ink">{t('positions')}</h3>
        <ul className="divide-y divide-line">
          {claim.positions.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
              <span className="min-w-0 text-ink">{p.kind === 'trip' ? t('trip', { from: p.tripFrom ?? '', to: p.tripTo ?? '', km: p.tripKm ?? 0 }) : p.purpose}</span>
              <span className="shrink-0 font-mono tabular-nums">{formatEuro(p.amountCents)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p data-testid="approver-names" className="text-[14px] text-ink-2">
        {claim.approverNames.length > 0 ? t('approvers', { names: claim.approverNames.join(' · ') }) : t('noApprover')}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/finance/expenses" className={buttonVariants({ variant: 'default' })}>
          {t('toList')}
        </Link>
        <Link href="/finance/expenses/new" className={buttonVariants({ variant: 'outline' })}>
          {t('another')}
        </Link>
      </div>
    </section>
  );
}
