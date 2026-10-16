import type { ExpenseClaimView } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatusBadge, statusTone } from '@/components/status-badge';
import type { DateFormatter } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { claimAmountMissing, claimHref, claimSentence } from '@/lib/finance/expenses';
import { Section } from '@/components/section';

/** Badge und Satz in Alltagssprache — gemeinsam für Karte und Ansicht des Antrags. */
export async function ClaimState({ claim, fmt }: { claim: ExpenseClaimView; fmt: DateFormatter }) {
  const t = await getTranslations('finance.expenses');
  const sentence = claimSentence(claim);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge tone={statusTone('claim', claim.stateLabelKey)}>{t(`state.${claim.stateLabelKey}`)}</StatusBadge>
      <span className="text-meta text-ink-2">{sentence.key === 'rejected' ? sentence.note : t(`sentence.${sentence.key}`, { date: fmt.date(sentence.date) })}</span>
    </span>
  );
}

/**
 * Ein Antrag als Karte (Designer-README 3g): Nummer, Betrag rechts, Badge mit
 * Satz, darunter der nächste Schritt. Die ganze Karte ist Trefferfläche
 * (mindestens 64 px) — ein Entwurf öffnet das Formular, alles andere die Ansicht.
 */
async function ClaimCard({ claim, fmt }: { claim: ExpenseClaimView; fmt: DateFormatter }) {
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
        className="flex min-h-16 flex-col gap-1.5 rounded-lg border border-line bg-surface p-4 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-body text-ink">{claim.number ?? t('draftNumber')}</span>
          {claimAmountMissing(claim) ? (
            <span className="shrink-0 text-body text-muted-ink">{t('amountMissing')}</span>
          ) : (
            <span className="shrink-0 text-body font-semibold tabular-nums text-ink">{formatEuro(claim.totalCents)}</span>
          )}
        </span>
        <ClaimState claim={claim} fmt={fmt} />
        <span className="text-hint text-muted-ink">{next}</span>
      </Link>
    </li>
  );
}

export async function ClaimGroup({ id, title, claims, fmt }: { id: 'open' | 'done'; title: string; claims: ExpenseClaimView[]; fmt: DateFormatter }) {
  if (claims.length === 0) return null;
  return (
    <section data-testid={`claims-${id}`} aria-labelledby={`claims-${id}-title`}>
      <Section title={title} headingId={`claims-${id}-title`}>
      <ul className="space-y-2">
        {claims.map((claim) => (
          <ClaimCard key={claim.id} claim={claim} fmt={fmt} />
        ))}
      </ul>
      </Section>
    </section>
  );
}
