import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type GuidedStepState = 'done' | 'active' | 'todo';

export interface GuidedStep {
  key: string;
  label: string;
  state: GuidedStepState;
  /** Wer und wann (Design-Nachtrag Phase 4, 4b): „20.05. · M. Beispiel“ — fertig übersetzt vom Aufrufer. */
  detail?: string;
}

const ONE_ACTIVE = 'GuidedSteps needs exactly one active step';

/** Zustände aus dem aktiven Schlüssel: davor erledigt, danach offen. */
export function guidedSteps(steps: readonly { key: string; label: string; detail?: string }[], activeKey: string): GuidedStep[] {
  const active = steps.findIndex((s) => s.key === activeKey);
  if (active < 0) throw new Error(ONE_ACTIVE);
  return steps.map((s, i) => ({ ...s, state: i < active ? 'done' : i === active ? 'active' : 'todo' }));
}

/**
 * Der waagrechte Schrittkopf einer geführten Seite (HANDOFF § 13.2, F6b
 * Annahme 13): erledigte Schritte mit Haken, der aktive hervorgehoben und mit
 * `aria-current="step"`, offene ruhig. Genau ein Schritt ist aktiv — alles
 * andere ist ein Fehler des Aufrufers. Kein Text im Baustein: Beschriftungen
 * und `label` (für Screenreader) kommen übersetzt vom Aufrufer.
 */
export function GuidedSteps({ steps, label }: { steps: readonly GuidedStep[]; label?: string }) {
  if (steps.filter((s) => s.state === 'active').length !== 1) throw new Error(ONE_ACTIVE);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="guided-steps" aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={step.key}
          data-testid={`guided-step-${step.key}`}
          data-state={step.state}
          aria-current={step.state === 'active' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1',
            step.state === 'active' ? 'border-brand bg-brand-soft font-semibold text-ink' : step.state === 'done' ? 'border-line text-ink' : 'border-line text-muted-ink',
          )}
        >
          {step.state === 'done' ? <Check className="size-3.5 text-success" aria-hidden /> : <span className="font-mono" aria-hidden>{index + 1}</span>}
          <span>{step.label}</span>
          {step.detail ? (
            <span data-testid={`guided-step-${step.key}-detail`} className="font-normal text-muted-ink">
              {step.detail}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
