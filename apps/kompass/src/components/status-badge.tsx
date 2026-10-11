import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand' | 'accent' | 'final' | 'agent';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
  info: 'bg-info-bg text-info',
  neutral: 'bg-badge text-badge-ink',
  brand: 'bg-brand-soft text-brand-ink',
  accent: 'bg-brand-accent-soft text-brand-accent-deep',
  final: 'bg-final-bg text-final',
  agent: 'bg-agent-bg text-agent',
};

/** `dot` und `icon` schließen sich aus: Eine Marke trägt höchstens ein Zeichen vor dem Text. */
type Mark = { dot?: boolean; icon?: never } | { dot?: never; icon?: LucideIcon };

/**
 * `testId`: Kennung für Tests (`data-testid` an der Marke). `stamp`: Stempel auf einem Foto (Wischkarte) — 15/600,
 * Rahmen 2 px in der Tonfarbe, Schatten; auf dem Bild trägt die normale Marke nicht (Designer 2026-10-11, § 14).
 */
export function StatusBadge({ tone, dot, icon: Icon, children, className, testId, stamp }: { tone: BadgeTone; children: React.ReactNode; className?: string; testId?: string; stamp?: boolean } & Mark) {
  const shape = stamp ? 'rounded-md border-2 border-current px-3 py-1.5 text-section shadow-sm' : 'rounded-sm px-2 py-0.5 text-hint';
  return (
    <span data-testid={testId} className={cn('inline-flex items-center gap-1.5', shape, 'font-semibold', TONES[tone], className)}>
      {dot ? <span className="size-[7px] rounded-full bg-current" aria-hidden /> : null}
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}
