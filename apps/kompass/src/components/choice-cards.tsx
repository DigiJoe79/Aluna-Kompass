'use client';

import { cn } from '@/lib/utils';

export interface ChoiceCardOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Baustein 15 (F7 Task 6a, HANDOFF): eine Reihe von Karten statt eines
 * Auswahlfelds — zwei Spielarten. `mode: 'choice'` ist eine Radiogruppe mit
 * gewähltem Wert (E1: Status/Art des Partners); `mode: 'action'` sind zwei
 * eigenständige Knöpfe, die sofort etwas auslösen, ohne einen Zustand zu
 * halten (A7: „Bar bezahlt“ — `finance-cash.spec.ts:124` bleibt unverändert,
 * weil ein Knopf ein Knopf bleibt). Keine Farbwerte, nur Theme-Tokens.
 */
export function ChoiceCards({
  mode,
  name,
  legend,
  options,
  value,
  onSelect,
}: {
  mode: 'choice' | 'action';
  name?: string;
  legend?: string;
  options: readonly ChoiceCardOption[];
  value?: string;
  onSelect: (value: string) => void;
}) {
  if (mode === 'action') {
    return (
      <div className="space-y-3" role="group" aria-label={legend} data-testid="choice-cards-action">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className="w-full rounded-md border border-line bg-surface px-4 py-3 text-left transition hover:border-brand"
            data-testid={`choice-card-${option.value}`}
          >
            <span className="block text-[14px] font-semibold text-ink">{option.label}</span>
            {option.description ? <span className="block text-[13px] text-muted-ink">{option.description}</span> : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <fieldset className="space-y-1" data-testid="choice-cards-choice">
      {legend ? <legend className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{legend}</legend> : null}
      <div role="radiogroup" aria-label={legend} className="space-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-md border px-4 py-3 transition',
              value === option.value ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-2',
            )}
            data-testid={`choice-card-${option.value}`}
          >
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onSelect(option.value)} className="mt-1 size-4" />
            <span>
              <span className="block text-[14px] font-semibold text-ink">{option.label}</span>
              {option.description ? <span className="block text-[13px] text-muted-ink">{option.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
