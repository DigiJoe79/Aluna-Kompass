'use client';

import type { AnimalStatus, ProposalField, ProposalHint } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/status-badge';
import { formatProposalValue } from '../field-format';
import { LOCALE_CODE } from '@/components/forms/localized-field';
import { cn } from '@/lib/utils';

export const statusTone = (status: string) => (status === 'adopted' ? 'success' : status === 'reserved' ? 'warning' : 'info') as 'success' | 'warning' | 'info';

/** Ein Wert in einer Fläche der Gegenüberstellung: Sprachfassungen untereinander mit Kürzel (Board „DE … EN …“), Status als Marke. */
export function FieldValue({ field, value, locales }: { field: ProposalField; value: unknown; locales: readonly string[] }) {
  const root = useTranslations();
  const f = useTranslations('animals.form');
  if (field === 'status' && typeof value === 'string' && value) {
    return (
      <StatusBadge tone={statusTone(value)} dot>
        {f(`status.${value as AnimalStatus}`)}
      </StatusBadge>
    );
  }
  const lines = formatProposalValue(field, value, { t: (key) => root(key), locales });
  if (lines.every((l) => !l.text)) return <span className="text-muted-ink">—</span>;
  return (
    <span className="flex flex-col gap-1">
      {lines.map((l) => (
        <span key={l.locale ?? 'value'} className="whitespace-pre-line">
          {l.locale ? <span className={cn('mr-1.5 rounded-sm px-1.5 py-0.5 uppercase', LOCALE_CODE)}>{l.locale}</span> : null}
          {l.text || <span className="text-muted-ink">—</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * Zweifelsfälle der Quelle unter dem Vorschlag, im Violett der Quelle: Zitat und, wenn vorhanden, ihr Vorschlag. Fett
 * steht immer „Zweifelsfall“ wie am Punkt des Reiters, damit man Punkt und Zeile zuordnet (Designer 2026-10-10); ein
 * Titel der Quelle folgt danach.
 */
export function HintLines({ hints }: { hints: readonly ProposalHint[] }) {
  const t = useTranslations('animals.proposals.review');
  if (hints.length === 0) return null;
  return (
    <span className="flex flex-col gap-1">
      {hints.map((h, i) => (
        <span key={i} className="text-meta text-agent" data-testid="proposal-hint">
          <span className="font-semibold">{t('hint')}</span>
          {h.title ? <> · {h.title}</> : null}
          {h.quote ? <> „{h.quote}“</> : null}
          {h.suggestion ? <> · {t('suggestion', { value: h.suggestion })}</> : null}
        </span>
      ))}
    </span>
  );
}
