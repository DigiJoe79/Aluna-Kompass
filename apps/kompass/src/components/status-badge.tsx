import { cn } from '@/lib/utils';

export type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand' | 'accent';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
  info: 'bg-info-bg text-info',
  neutral: 'bg-badge text-badge-ink',
  brand: 'bg-brand-soft text-brand-ink',
  accent: 'bg-brand-accent-soft text-brand-accent-deep',
};

export function StatusBadge({ tone, dot, children, className }: { tone: BadgeTone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12px] font-semibold', TONES[tone], className)}>
      {dot ? <span className="size-[7px] rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}
