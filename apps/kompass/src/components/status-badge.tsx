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

export function StatusBadge({ tone, dot, icon: Icon, children, className }: { tone: BadgeTone; children: React.ReactNode; className?: string } & Mark) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12px] font-semibold', TONES[tone], className)}>
      {dot ? <span className="size-[7px] rounded-full bg-current" aria-hidden /> : null}
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}
