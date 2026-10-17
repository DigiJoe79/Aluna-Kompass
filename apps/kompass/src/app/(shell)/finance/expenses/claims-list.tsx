import { expenseClaimTitle, type ExpenseClaimView } from '@kompass/module-finance';
import { KeyLine } from '@/components/key-line';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatusBadge, statusTone } from '@/components/status-badge';
import type { DateFormatter } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { claimAmountMissing, claimHref, claimSentence } from '@/lib/finance/expenses';
import { Section } from '@/components/section';

/**
 * Badge und Satz in Alltagssprache — gemeinsam für Karte und Ansicht des Antrags. Marke und ein Satz genügen (08 A3):
 * Die Ansicht des Antrags nennt ihren eigenen Satz (`sentence={false}`), das Datum steht dort im Verlauf.
 */
export async function ClaimState({ claim, fmt, sentence: withSentence = true }: { claim: ExpenseClaimView; fmt: DateFormatter; sentence?: boolean }) {
  const t = await getTranslations('finance.expenses');
  const sentence = claimSentence(claim);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge tone={statusTone('claim', claim.stateLabelKey)}>{t(`state.${claim.stateLabelKey}`)}</StatusBadge>
      {withSentence ? <span className="text-meta text-ink-2">{sentence.key === 'rejected' ? sentence.note : t(`sentence.${sentence.key}`, { date: fmt.date(sentence.date) })}</span> : null}
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
  const title = expenseClaimTitle(claim);
  // 08 A3 · 08 A4: Eine dritte Zeile nur, wo sie etwas Neues sagt — wer freigeben kann, was nach einer Ablehnung geht.
  const next =
    claim.stateLabelKey === 'submitted'
      ? claim.approverNames.length > 0
        ? t('next.submitted', { names: claim.approverNames.join(' · ') })
        : t('next.submittedNobody')
      : claim.stateLabelKey === 'rejected'
        ? t('next.rejected')
        : null;
  return (
    <li>
      <Link
        href={claimHref(claim)}
        data-testid="claim-card"
        className="flex min-h-16 flex-col gap-1.5 rounded-lg border border-line bg-surface p-4 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex items-baseline justify-between gap-3">
          {/* Titel aus dem Zweck der ersten Position, die Nummer klein darunter; ohne Zweck die Nummer bzw. „Entwurf“
              in der Textschrift — Mono nur für die Nummer selbst (02 A1, 08 A1, 08 B8). */}
          <span className="min-w-0">
            {title ? (
              <>
                <span className="block truncate text-body text-ink">{title}</span>
                {claim.number ? <KeyLine>{claim.number}</KeyLine> : null}
              </>
            ) : claim.number ? (
              <span className="font-mono text-body text-ink">{claim.number}</span>
            ) : (
              <span className="text-body text-ink">{t('draftNumber')}</span>
            )}
          </span>
          {claimAmountMissing(claim) ? (
            <span className="shrink-0 text-body text-muted-ink">{t('amountMissing')}</span>
          ) : (
            <span className="shrink-0 text-body font-semibold tabular-nums text-ink">{formatEuro(claim.totalCents)}</span>
          )}
        </span>
        <ClaimState claim={claim} fmt={fmt} />
        {next ? <span className="text-hint text-muted-ink">{next}</span> : null}
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
