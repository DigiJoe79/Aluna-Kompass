import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Etikett über einem Wert oder gleichartigen Zeilen (Summen, Gruppen, Tasten, Prüfpunkte) — kein Abschnitt, keine
 * Überschrift (K10 Charge 3, Designer 2026-10-10, § 2 und § 8). Darunter gemischter Inhalt → `Section`.
 * Dieselbe Rolle wie der Tabellenkopf. `className` nur für Layout.
 */
export function Overline({ as: Tag = 'p', children, className }: { as?: 'p' | 'dt' | 'span' | 'div'; children: ReactNode; className?: string }) {
  return <Tag className={cn('text-label uppercase text-muted-ink', className)}>{children}</Tag>;
}
