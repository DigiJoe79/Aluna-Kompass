import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Technischer Schlüssel unter einem Klartext (Recht, Modul, Dokumentart, Protokoll, Token): eigene Zeile, mono,
 * 11 px, gedämpft — er steht unter dem Namen und macht ihm keine Konkurrenz (K10 Charge 3, Designer § 1).
 */
export function KeyLine({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('block font-mono text-key text-muted-ink', className)}>{children}</span>;
}
