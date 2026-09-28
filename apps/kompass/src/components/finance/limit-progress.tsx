import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { StatusBadge, type BadgeTone } from '@/components/status-badge';
import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress';

/**
 * Zustand gegen eine Grenze (Design 4h, F8b Annahme 17): *ruhig* ·
 * *nähert sich* (ab `warnAtPercent`) · *überschritten* · *erreicht* (nur für
 * Zielbeträge). Die Rechnung steht nur hier — Dienste liefern Zahlen, keinen
 * Zustand. Ohne Grenze (`limitCents ≤ 0`) kein Zustand.
 */
export type LimitState = 'calm' | 'near' | 'exceeded' | 'reached';

export function limitState({ valueCents, limitCents, warnAtPercent, kind }: { valueCents: number; limitCents: number; warnAtPercent: number; kind: 'limit' | 'target' }): LimitState | null {
  if (limitCents <= 0) return null;
  if (kind === 'target') return valueCents >= limitCents ? 'reached' : 'calm';
  if (valueCents > limitCents) return 'exceeded';
  return valueCents * 100 >= limitCents * warnAtPercent ? 'near' : 'calm';
}

const TONE: Record<LimitState, BadgeTone> = { calm: 'neutral', near: 'warning', exceeded: 'error', reached: 'success' };
const BAR: Record<LimitState, string> = { calm: 'bg-primary', near: 'bg-warning', exceeded: 'bg-error', reached: 'bg-success' };

/**
 * Baustein 16 (F7 Task 6a, Design 4h): Label · Zustandswort als Badge ·
 * Balken 8 px · „Wert von Grenze“ in Mono · Restsatz. Alle Texte kommen fertig
 * übersetzt vom Aufrufer (Muster `GuidedSteps`); die Komponente trägt keinen
 * Text. Läuft ohne Zustand, deshalb eine Server-Komponente. Genau ein Balken:
 * `ProgressPrimitive.Root` statt `ui/progress`, das seinen eigenen anhängt.
 */
export function LimitProgress({
  coveredCents,
  totalCents,
  label,
  state,
  stateLabel,
  figure,
  remainder,
  hideLabel,
}: {
  coveredCents: number;
  totalCents: number;
  label: string;
  state?: LimitState | null;
  stateLabel?: string;
  figure?: string;
  remainder?: string;
  /** Schmale Form (Design 4c, Ziel in der Tabelle): das Label bleibt für Screenreader, sichtbar steht nur „x von y“. */
  hideLabel?: boolean;
}) {
  const value = totalCents > 0 ? Math.min(100, Math.max(0, Math.round((coveredCents / totalCents) * 100))) : coveredCents > 0 ? 100 : 0;
  return (
    <ProgressPrimitive.Root value={value} data-testid="limit-progress" data-state={state ?? undefined} aria-label={label} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className={hideLabel ? 'sr-only' : 'text-[13px] text-ink-2'}>{label}</p>
        {state && stateLabel ? <StatusBadge tone={TONE[state]}>{stateLabel}</StatusBadge> : null}
        {figure ? <span className={`${hideLabel ? '' : 'ml-auto '}font-mono text-[12px] tabular-nums text-ink`}>{figure}</span> : null}
      </div>
      <ProgressTrack className={`h-2 ${state === 'exceeded' ? 'border-r-2 border-error' : ''}`}>
        <ProgressIndicator className={BAR[state ?? 'calm']} />
      </ProgressTrack>
      {remainder ? <p className="text-[12px] text-muted-ink">{remainder}</p> : null}
    </ProgressPrimitive.Root>
  );
}
