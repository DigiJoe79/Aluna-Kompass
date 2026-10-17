import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Etikett über einem Wert oder gleichartigen Zeilen (Summen, Gruppen, Tasten, Prüfpunkte) — kein Abschnitt, keine
 * Überschrift (K10 Charge 3, Designer 2026-10-10, § 2 und § 8). Darunter gemischter Inhalt → `Section`.
 * Dieselbe Rolle wie der Tabellenkopf. `className` nur für Layout.
 *
 * `field`: In Dialogen steht über Feldern und Gruppen eine normale Feldbezeichnung (13/600, keine Versalien), keine
 * Kapitälchen (Designer Runde 3: 148, 157, 195, 210).
 */
export function Overline({ as: Tag = 'p', field, children, className }: { as?: 'p' | 'dt' | 'span' | 'div'; field?: boolean; children: ReactNode; className?: string }) {
  return <Tag className={cn(field ? 'text-meta font-semibold text-ink' : 'text-label uppercase text-muted-ink', className)}>{children}</Tag>;
}
