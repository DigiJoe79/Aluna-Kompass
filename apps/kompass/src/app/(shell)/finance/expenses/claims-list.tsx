import type { ExpenseClaimView } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { formatEuro } from '@/lib/finance/amount';
import { CLAIM_BADGE_TONE, claimHref, claimSentence } from '@/lib/finance/expenses';

/** Badge und Satz in Alltagssprache — gemeinsam für Karte und Ansicht des Antrags. */
export async function ClaimState({ claim, mode }: { claim: ExpenseClaimView; mode: DateFormatMode }) {
  const t = await getTranslations('finance.expenses');
  const sentence = claimSentence(claim);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge tone={CLAIM_BADGE_TONE[claim.stateLabelKey]}>{t(`state.${claim.stateLabelKey}`)}</StatusBadge>
      <span className="text-[13px] text-ink-2">{sentence.key === 'rejected' ? sentence.note : t(`sentence.${sentence.key}`, { date: formatDate(sentence.date, mode) })}</span>
    </span>
  );
}

/**
 * Ein Antrag als Karte (Designer-README 3g): Nummer, Betrag rechts, Badge mit
 * Satz, darunter der nächste Schritt. Die ganze Karte ist Trefferfläche
 * (mindestens 64 px) — ein Entwurf öffnet das Formular, alles andere die Ansicht.
 */
async function ClaimCard({ claim, mode }: { claim: ExpenseClaimView; mode: DateFormatMode }) {
  const t = await getTranslations('finance.expenses.list');
  const next =
    claim.stateLabelKey === 'submitted'
      ? claim.approverNames.length > 0
        ? t('next.submitted', { names: claim.approverNames.join(' · ') })
        : t('next.submittedNobody')
      : t(`next.${claim.stateLabelKey}`);
  return (
    <li>
      <Link
        href={claimHref(claim)}
        data-testid="claim-card"
        className="flex min-h-16 flex-col gap-1.5 rounded-lg border border-line bg-surface p-4 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[14px] font-semibold text-ink">{claim.number ?? t('draftNumber')}</span>
          <span className="shrink-0 font-mono text-[16px] font-semibold tabular-nums text-ink">{formatEuro(claim.totalCents)}</span>
        </span>
        <ClaimState claim={claim} mode={mode} />
        <span className="text-[12px] text-muted-ink">{next}</span>
      </Link>
    </li>
  );
}

export async function ClaimGroup({ id, title, claims, mode }: { id: 'open' | 'done'; title: string; claims: ExpenseClaimView[]; mode: DateFormatMode }) {
  if (claims.length === 0) return null;
  return (
    <section data-testid={`claims-${id}`} aria-labelledby={`claims-${id}-title`} className="space-y-2">
      <h3 id={`claims-${id}-title`} className="text-[13px] font-semibold text-muted-ink">
        {title}
      </h3>
      <ul className="space-y-2">
        {claims.map((claim) => (
          <ClaimCard key={claim.id} claim={claim} mode={mode} />
        ))}
      </ul>
    </section>
  );
}
