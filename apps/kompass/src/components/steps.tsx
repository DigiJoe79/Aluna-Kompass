'use client';

import { Check, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { Overline } from '@/components/overline';
import { Button } from '@/components/ui/button';
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
  if (active < 0) throw new RangeError(activeKey); // ein Schlüssel, der in `steps` fehlt
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
  groups,
  card,
  collapsedWhenDone,
  testId = 'steps',
}: {
  steps: readonly Step[];
  density?: 'bar' | 'compact';
  /** Name der Liste für Vorleser; Vorgabe „Schritte“. */
  label?: string;
  /** Ergebnis, wenn alle Schritte erledigt sind („128 Umsätze eingelesen.“). */
  done?: ReactNode;
  /**
   * Nur `compact` (Board 3a, Freigabe Joe 2026-10-24): Gruppen mit `Overline` darüber, je Gruppe eine Liste; die
   * Nummern zählen über die Gruppen durch (Index in `steps` + 1). Jeder Schritt gehört zu genau einer Gruppe.
   */
  groups?: readonly { label: string; keys: readonly string[] }[];
  /**
   * Nur `compact` ohne `groups` (Designer Runde 6, vorläufig, Joe 2026-10-25): dieselbe Karte mit Zeilen und Trennern
   * wie mit Gruppen, aber ohne `Overline` — bei nur einer Gruppe sagt der Seitentitel schon, worum es geht.
   */
  card?: boolean;
  /** Nur `compact` (Board 3c): Sind alle erledigt, steht „Fertig.“ mit Ergebnis, die Liste zugeklappt hinter dem Knopf. */
  collapsedWhenDone?: { label: string };
  testId?: string;
}) {
  const t = useTranslations('common.steps');
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const current = steps.filter((s) => s.state === 'active' || s.state === 'failed');
  if (current.length > 1) throw new Error(MANY_ACTIVE);
  const allDone = steps.length > 0 && steps.every((s) => s.state === 'done');
  const finished = allDone ? (
    // Haken, „Fertig.“ und Ergebnis auf einer Grundlinie (Designer Runde 6, 301): Der Haken steht mittig für sich,
    // das Wort ist ein eigenes Kind des `items-baseline` — in einem `inline-flex` mit dem Haken stand es 3 px höher.
    <p role="status" className="flex flex-wrap items-baseline gap-x-1.5 text-meta text-ink-2">
      <Check className="size-3.5 self-center text-success" aria-hidden />
      <span className="-ml-0.5 font-semibold text-success">{t('finished')}</span>
      {done}
    </p>
  ) : null;

  if (density === 'compact') {
    const carded = Boolean(groups) || card === true;
    const item = (step: Step) => {
      const index = steps.indexOf(step);
      const common = { id: `step-${step.key}`, 'data-testid': `${testId}-${step.key}`, 'data-state': step.state, 'aria-current': isCurrent(step) ? ('step' as const) : undefined };
      if (carded) {
        // Board 3a: Zeile mit Trenner, Marke oben bündig; rechts Name, Ergebnis und Körper untereinander.
        return (
          // Der letzte Schritt der Karte hat keine Unterkante (Designer Runde 6, 15a): Darunter ist der Rand der Karte.
          <li key={step.key} {...common} className={cn('flex scroll-mt-4 items-start gap-3 py-2.5', index < steps.length - 1 && 'border-b border-line-2')}>
            <Marker step={step} n={index + 1} size="compact" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-h-5 items-center gap-2.5">
                <span className={cn('min-w-0 text-body', labelClass(step))}>{step.label}</span>
                {step.action ? <span className="ml-auto shrink-0 text-meta">{step.action}</span> : null}
              </div>
              {step.detail ? (
                <div className="text-meta text-pretty text-muted-ink" data-testid={`${testId}-${step.key}-detail`}>
                  {step.detail}
                </div>
              ) : null}
              {step.state === 'failed' && step.failure ? (
                <p role="alert" className="text-hint text-error">
                  {step.failure}
                </p>
              ) : null}
              {step.below ? <div className="pt-1.5">{step.below}</div> : null}
            </div>
          </li>
        );
      }
      return (
        <li key={step.key} {...common} className="flex scroll-mt-4 flex-col gap-1.5">
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
      );
    };
    const lists = groups ? (
      // Board 3a: alle Gruppen in einer Karte (`surface`, Rand `line`, 8/20/12, am Telefon seitlich 16).
      <div className="flex flex-col rounded-lg border border-line bg-surface px-4 pt-2 pb-3 sm:px-5" data-testid={`${testId}-card`}>
        {groups.map((group, g) => {
          const members = steps.filter((s) => group.keys.includes(s.key));
          const start = members[0] ? steps.indexOf(members[0]) + 1 : 1;
          return (
            <div key={group.label} className="flex flex-col">
              <div className={cn('pb-1.5', g === 0 ? 'pt-3' : 'pt-4')}>
                <Overline>{group.label}</Overline>
              </div>
              <ol aria-label={group.label} start={start > 1 ? start : undefined} className="flex flex-col">
                {members.map(item)}
              </ol>
            </div>
          );
        })}
      </div>
    ) : card ? (
      // Runde 6, Antwort 2: dieselbe Karte, eine Liste ohne Etikett darüber.
      <div className="flex flex-col rounded-lg border border-line bg-surface px-4 pt-2 pb-3 sm:px-5" data-testid={`${testId}-card`}>
        <ol aria-label={label ?? t('label')} className="flex flex-col">
          {steps.map(item)}
        </ol>
      </div>
    ) : (
      <ol aria-label={label ?? t('label')} className="flex flex-col gap-1.5">
        {steps.map(item)}
      </ol>
    );
    if (groups) {
      const grouped = new Set(groups.flatMap((g) => g.keys));
      const loose = steps.find((s) => !grouped.has(s.key));
      if (loose) throw new RangeError(loose.key); // ein Schritt ohne Gruppe
    }
    const collapsed = allDone && collapsedWhenDone;
    return (
      <div className={cn('flex flex-col', carded ? 'gap-4' : 'gap-1.5')} data-testid={testId}>
        {collapsed ? (
          <>
            {finished}
            <div>
              <Button type="button" variant="outline" size="sm" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((v) => !v)} data-testid={`${testId}-toggle`}>
                <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} aria-hidden />
                {collapsedWhenDone.label}
              </Button>
            </div>
            <div id={listId} hidden={!expanded}>
              {lists}
            </div>
          </>
        ) : (
          <>
            {lists}
            {finished ? <div className={carded ? undefined : 'pl-7.5'}>{finished}</div> : null}
          </>
        )}
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
