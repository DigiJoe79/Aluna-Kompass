import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Ein Tastenkürzel als kleine Taste (HANDOFF § 12.1, `KeyChip`): `kbd` in
 * `bg-key`/`text-key-ink`, hell mit leichtem Schatten, dunkel ohne — damit
 * die Taste auf `surface` und `surface-2` erhaben bleibt.
 */
export function KeyChip({ children, label, className }: { children: ReactNode; /** Vorgelesener Name der Taste, wenn das Zeichen allein nichts sagt (`↑`, `→`). */ label?: string; className?: string }) {
  return (
    <kbd
      aria-label={label}
      className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-key px-1.5 font-mono text-[11px] font-semibold text-key-ink shadow-sm dark:shadow-none', className)}
    >
      {children}
    </kbd>
  );
}
