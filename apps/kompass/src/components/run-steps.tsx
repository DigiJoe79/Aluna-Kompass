'use client';

// Client-Baustein: `Progress` bekommt eine Funktion (`getAriaValueText`), und die Wartungsseite rendert die Liste aus
// einer Server-Komponente — ohne diese Grenze scheiterte `/maintenance` mit einem laufenden Schritt (500).
import { Check, Circle, Minus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Progress } from '@/components/ui/progress';

export type RunStepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface RunStep {
  key: string;
  /** Fertig übersetzt. */
  label: string;
  state: RunStepState;
  /** „2.310 von 3.402“, „312 von 641 MB“ — fertig übersetzt. */
  counter?: string | null;
  /** Nur bei `running` und `total > 0` steht ein Balken. */
  progress?: { done: number; total: number } | null;
  /** Satz unter der Zeile (übersprungen mit Grund, gescheitert mit Grund). */
  note?: ReactNode;
}

const icon = (state: RunStepState) => {
  switch (state) {
    case 'done':
      return <Check className="size-[18px] shrink-0 text-success" aria-hidden />;
    case 'running':
      return <span className="size-[18px] shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />;
    case 'skipped':
      return <Minus className="size-[18px] shrink-0" aria-hidden />;
    case 'failed':
      return <X className="size-[18px] shrink-0 text-error" aria-hidden />;
    default:
      return <Circle className="size-[18px] shrink-0" aria-hidden />;
  }
};

const tone = (state: RunStepState) => (state === 'pending' ? 'text-muted-ink' : state === 'failed' ? 'text-error' : 'text-ink');

/**
 * Schrittliste eines Hintergrundlaufs (N2, Spec Backup § Bausteine, Freigabe Joe 2026-10-23) — Publizieren,
 * Backup-Lauf, Wartungsseite. Rein darstellend: Beschriftungen, Zähler und Fortschritt kommen fertig vom Aufrufer.
 * „Gescheitert“ ersetzt den laufenden Schritt (× in `error`, Grund als Satz darunter).
 */
export function RunSteps({ steps, label, testId }: { steps: readonly RunStep[]; label?: string; testId?: string }) {
  const t = useTranslations('common.runSteps');
  return (
    <ol aria-label={label ?? t('label')} className="flex flex-col gap-2 text-body">
      {steps.map((step) => {
        const bar = step.state === 'running' && step.progress && step.progress.total > 0 ? step.progress : null;
        return (
          <li
            key={step.key}
            data-state={step.state}
            data-testid={testId ? `${testId}-${step.key}` : undefined}
            aria-current={step.state === 'running' ? 'step' : undefined}
            className={`flex flex-col gap-1 ${tone(step.state)}`}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {icon(step.state)}
              <span>{step.label}</span>
              {step.counter ? <span className="text-meta text-ink-2 tabular-nums max-sm:basis-full max-sm:pl-[26px]">{step.counter}</span> : null}
              <span className="ml-auto text-meta text-muted-ink">{t(`state.${step.state}`)}</span>
            </div>
            {step.note ? <p className={`pl-7 text-meta ${step.state === 'failed' ? 'text-ink-2' : 'text-muted-ink'}`}>{step.note}</p> : null}
            {bar ? (
              <Progress
                className="pl-7"
                value={Math.round((bar.done / bar.total) * 100)}
                aria-label={step.label}
                getAriaValueText={() => step.counter ?? ''}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
