import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StepState = 'todo' | 'active' | 'done' | 'failed';

export interface Step {
  key: string;
  label: string;
  state: StepState;
  /** Wer und wann, fertig übersetzt vom Aufrufer („14.10.2026“, „20.05. · M. Beispiel“). */
  detail?: ReactNode;
  /** Ein erledigter Schritt mit Ziel ist ein Link zurück — nur wo der Ablauf das erlaubt. */
  href?: string;
  /** Satz unter einem fehlgeschlagenen Schritt. */
  failure?: ReactNode;
  /** Kompakt: die Handlung am Schritt, rechts in der Zeile („PDF öffnen“). */
  action?: ReactNode;
  /** Kompakt: was unter der Zeile steht (Ablagefläche mit Satz). */
  below?: ReactNode;
}

const MANY_ACTIVE = 'Steps allows at most one active step';

/** Zustände aus dem aktiven Schlüssel: davor erledigt, danach offen. `null` heißt: alle erledigt. */
export function stepsFrom(
  steps: readonly { key: string; label: string; detail?: ReactNode }[],
  activeKey: string | null,
  { failed = false }: { failed?: boolean } = {},
): Step[] {
  if (activeKey === null) return steps.map((s) => ({ ...s, state: 'done' }));
  const active = steps.findIndex((s) => s.key === activeKey);
  if (active < 0) throw new Error(`unknown step ${activeKey}`);
  return steps.map((s, i) => ({ ...s, state: i < active ? 'done' : i === active ? (failed ? 'failed' : 'active') : 'todo' }));
}

/**
 * Schritte (Entwurf E3, Designer 2026-10-17; docs/MUSTER.md § B): ein Muster in zwei Dichten.
 *
 * - `bar` (Leiste): ein Ablauf über mehrere Bildschirme — Serienlauf, CSV-Assistent, Publizieren. Ab `lg` waagerecht,
 *   gleich breite Schritte mit Verbindung; darunter „Schritt n von m“, der Name des aktiven Schritts, ein
 *   Segmentbalken (`progressbar`) und „Danach: …“.
 * - `compact`: eine Prüfliste an einem Gegenstand, alle Schritte sichtbar, ein Schritt eine Zeile („Unterschrift
 *   fehlt“); der aktive Schritt trägt seine Handlung.
 *
 * Zustände: offen, aktiv, erledigt, fehlgeschlagen (ersetzt aktiv), und „alle erledigt“ mit „Fertig.“ und dem
 * Ergebnis (`done`) als `status`. Nie mehr als ein Schritt aktiv. Beschriftungen kommen übersetzt vom Aufrufer.
 */
export function Steps({
  steps,
  density = 'bar',
  label,
  done,
  testId = 'steps',
}: {
  steps: readonly Step[];
  density?: 'bar' | 'compact';
  /** Name der Liste für Vorleser; Vorgabe „Schritte“. */
  label?: string;
  /** Ergebnis, wenn alle Schritte erledigt sind („128 Umsätze eingelesen.“). */
  done?: ReactNode;
  testId?: string;
}) {
  const t = useTranslations('common.steps');
  const current = steps.filter((s) => s.state === 'active' || s.state === 'failed');
  if (current.length > 1) throw new Error(MANY_ACTIVE);
  const allDone = steps.length > 0 && steps.every((s) => s.state === 'done');
  const finished = allDone ? (
    <p role="status" className="flex flex-wrap items-baseline gap-x-1.5 text-meta text-ink-2">
      <span className="inline-flex items-center gap-1 font-semibold text-success">
        <Check className="size-3.5" aria-hidden />
        {t('finished')}
      </span>
      {done}
    </p>
  ) : null;

  if (density === 'compact') {
    return (
      <div className="flex flex-col gap-1.5" data-testid={testId}>
        <ol aria-label={label ?? t('label')} className="flex flex-col gap-1.5">
          {steps.map((step, index) => (
            <li key={step.key} data-testid={`${testId}-${step.key}`} data-state={step.state} aria-current={isCurrent(step) ? 'step' : undefined} className="flex flex-col gap-1.5">
              <div className="flex min-h-7 items-center gap-2.5">
                <Marker step={step} n={index + 1} size="compact" />
                <span className={cn('min-w-0 text-meta', labelClass(step))}>
                  {step.label}
                  {step.detail ? <span className="font-normal text-muted-ink"> · {step.detail}</span> : null}
                </span>
                {step.action ? <span className="ml-auto shrink-0 text-meta">{step.action}</span> : null}
              </div>
              {step.state === 'failed' && step.failure ? (
                <p role="alert" className="pl-7.5 text-hint text-error">
                  {step.failure}
                </p>
              ) : null}
              {step.below ? <div className="pl-7.5">{step.below}</div> : null}
            </li>
          ))}
        </ol>
        {finished ? <div className="pl-7.5">{finished}</div> : null}
      </div>
    );
  }

  const active = current[0];
  const activeIndex = active ? steps.indexOf(active) : -1;
  const next = activeIndex >= 0 ? steps[activeIndex + 1] : undefined;
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <ol
        aria-label={label ?? t('label')}
        className={cn('grid gap-2 max-lg:hidden', steps.length <= 2 ? 'max-w-[27.5rem]' : steps.length <= 4 ? 'max-w-[55rem]' : '')}
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, index) => {
          const marker = <Marker step={step} n={index + 1} size="bar" />;
          const linked = step.state === 'done' && step.href;
          return (
            <li key={step.key} data-testid={`${testId}-${step.key}`} data-state={step.state} aria-current={isCurrent(step) ? 'step' : undefined} className="relative flex flex-col gap-1.5">
              {/* Verbindung zum nächsten Schritt: 2 px, `brand` hinter erledigten Schritten, sonst `line`. */}
              {index < steps.length - 1 ? (
                <span aria-hidden className={cn('absolute top-[11px] right-0 left-8 h-0.5 rounded-full', step.state === 'done' ? 'bg-brand' : 'bg-line')} />
              ) : null}
              {linked ? (
                <Link href={step.href!} className="group flex w-fit flex-col gap-1.5 rounded-sm focus-visible:outline-offset-[3px]">
                  {marker}
                  <span className={cn('text-meta text-pretty group-hover:underline', labelClass(step))}>{step.label}</span>
                </Link>
              ) : (
                <>
                  {marker}
                  <span className={cn('text-meta text-pretty', labelClass(step))}>{step.label}</span>
                </>
              )}
              {step.detail ? <span className="text-hint text-muted-ink">{step.detail}</span> : null}
              {step.state === 'failed' && step.failure ? (
                <p role="alert" className="text-hint text-error">
                  {step.failure}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="max-lg:block lg:hidden">
        <PhoneSteps steps={steps} active={active} activeIndex={activeIndex} next={next} allDone={allDone} />
      </div>
      {finished}
    </div>
  );
}

function PhoneSteps({ steps, active, activeIndex, next, allDone }: { steps: readonly Step[]; active?: Step; activeIndex: number; next?: Step; allDone: boolean }) {
  const t = useTranslations('common.steps');
  const total = steps.length;
  const doneCount = steps.filter((s) => s.state === 'done').length;
  const n = active ? activeIndex + 1 : doneCount;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-baseline justify-between gap-3 text-meta text-muted-ink">
        <span>{allDone ? t('doneOf', { n: total, total }) : t('stepOf', { n, total })}</span>
        {active?.state === 'failed' ? <span className="font-semibold text-error">{t('failed')}</span> : null}
      </p>
      {active ? <p className="text-section text-ink">{active.label}</p> : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={n}
        aria-valuetext={active ? t('progress', { n, total, label: active.label }) : t('doneOf', { n: doneCount, total })}
        className="flex gap-1"
      >
        {steps.map((step) => (
          <span
            key={step.key}
            aria-hidden
            className={cn('h-1 flex-1 rounded-full', step.state === 'failed' ? 'bg-error' : step.state === 'todo' ? 'bg-line' : 'bg-brand')}
          />
        ))}
      </div>
      {next ? <p className="text-hint text-muted-ink">{t('next', { label: next.label })}</p> : null}
      {active?.state === 'failed' && active.failure ? (
        <p role="alert" className="text-hint text-error">
          {active.failure}
        </p>
      ) : null}
    </div>
  );
}

const isCurrent = (step: Step) => step.state === 'active' || step.state === 'failed';

function labelClass(step: Step): string {
  switch (step.state) {
    case 'active':
      return 'font-semibold text-ink';
    case 'failed':
      return 'font-semibold text-error';
    case 'done':
      return 'text-ink';
    default:
      return 'text-muted-ink';
  }
}

/**
 * Der Marker: Kreis 24 px (Leiste) bzw. 20 px (kompakt). Die Ziffern sind Grafik im Kreis, keine Schriftrolle
 * (Erlaubnisliste „Grafik, keine Schrift“). Der Zustand steht zusätzlich als Text für Vorleser.
 */
function Marker({ step, n, size }: { step: Step; n: number; size: 'bar' | 'compact' }) {
  const t = useTranslations('common.steps');
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums',
        size === 'bar' ? 'size-6 text-[12px]' : 'size-5 text-[11px]',
        step.state === 'todo' && 'border border-line-strong bg-surface text-muted-ink',
        step.state === 'active' && 'bg-brand text-on-brand ring-4 ring-brand-soft',
        step.state === 'done' && 'bg-brand text-on-brand',
        step.state === 'failed' && 'border border-error bg-error-bg text-error',
      )}
    >
      {step.state === 'done' ? <Check className={size === 'bar' ? 'size-3.5' : 'size-3'} aria-hidden /> : <span aria-hidden>{step.state === 'failed' ? '!' : n}</span>}
      <span className="sr-only">{t(`state.${step.state}`)}</span>
    </span>
  );
}
