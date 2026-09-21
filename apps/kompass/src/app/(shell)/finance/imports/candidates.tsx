'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BeforeAfter } from '@/components/before-after';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { decideCandidateAction } from './actions';

export interface CandidateRow {
  id: string;
  accountName: string;
  line: { bookingDate: string; counterpartyName: string | null; purpose: string; amountCents: number };
  existing: { bookingDate: string; counterpartyName: string | null; purpose: string; amountCents: number; state: 'open' | 'booked'; entryId: string | null; entryNumber: string | null } | null;
}

/**
 * Dubletten-Gegenüberstellung (F4 Task 7, HANDOFF § 12.1/12.4): `BeforeAfter
 * layout="cards"` — „Im Auszug“ (stärkerer Rand) ↔ „Bereits vorhanden“. Der
 * primäre Knopf ist **„Dieselbe Zahlung — nicht übernehmen“** (E8: der
 * Kandidat bleibt stehen, entschieden). Nur mit `finance.entriesWrite`
 * anklickbar — sonst nur lesbar (`canDecide`).
 */
export function CandidatesSection({ candidates, canDecide }: { candidates: CandidateRow[]; canDecide: boolean }) {
  const t = useTranslations('finance.imports.candidates');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const decide = (id: string, decision: 'same' | 'own') => {
    setDecidingId(id);
    start(async () => {
      const result = await decideCandidateAction(id, decision);
      if (result.status === 'error') toast.error(result.message);
      router.refresh();
      setDecidingId(null);
    });
  };

  if (candidates.length === 0) return null;

  return (
    <section aria-label={t('title')} className="space-y-4">
      <h2 className="font-heading text-[16px]">{t('title')}</h2>
      {candidates.map((c) => (
        <div key={c.id} className="space-y-2 rounded-md border border-line bg-surface p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-ink">{c.accountName}</p>
          <BeforeAfter
            layout="cards"
            columnLabels={{ before: t('inStatement'), after: t('existing') }}
            rows={[
              {
                label: '',
                before: (
                  <span>
                    {c.line.bookingDate} · {c.line.counterpartyName ?? '—'} · {c.line.purpose || '—'} · <span className="font-mono tabular-nums">{formatEuro(c.line.amountCents)}</span>
                  </span>
                ),
                after: c.existing ? (
                  <span>
                    {c.existing.bookingDate} · {c.existing.counterpartyName ?? '—'} · {c.existing.purpose || '—'} · <span className="font-mono tabular-nums">{formatEuro(c.existing.amountCents)}</span> ·{' '}
                    {c.existing.state === 'booked' && c.existing.entryId ? (
                      <Link href={`/finance/entries/${c.existing.entryId}`} className="text-link">
                        {c.existing.entryNumber}
                      </Link>
                    ) : (
                      t('existingOpen')
                    )}
                  </span>
                ) : (
                  '—'
                ),
              },
            ]}
          />
          {canDecide ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending && decidingId === c.id} onClick={() => decide(c.id, 'same')}>
                {t('same')}
              </Button>
              <Button type="button" variant="secondary" disabled={pending && decidingId === c.id} onClick={() => decide(c.id, 'own')}>
                {t('own')}
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
