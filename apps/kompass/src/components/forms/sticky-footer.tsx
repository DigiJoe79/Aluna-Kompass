import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Die klebende Fußleiste einer Maske (HANDOFF § 6 „Klebt“, wie D1): bleibt am
 * unteren Fensterrand, solange die Maske läuft, und trägt Speicherzeile,
 * Meldungen und Knöpfe. In Dialogen klebt nichts — dort nicht verwenden.
 */
export function StickyFooter({ testId, className, children }: { testId?: string; className?: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className={cn('sticky bottom-0 z-10 space-y-2 rounded-md border border-line bg-surface px-3 py-3 shadow-md', className)}>
      {children}
    </div>
  );
}
