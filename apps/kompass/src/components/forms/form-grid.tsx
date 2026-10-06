import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { FieldSize } from './form-field';

/**
 * Die Spannweite als Klassen (docs/MUSTER.md § J). Nicht exportiert: Ein Element im `FormGrid` wählt seine Breite
 * über `FormField size` oder `FormCell size`, nie über Klassen von Hand (Wächter `tests/patterns/form-grid.test.ts`).
 */
const FIELD_SPAN: Record<FieldSize, string> = {
  s: '',
  m: '@[880px]:col-span-2',
  l: '@[420px]:col-span-2 @[880px]:col-span-3',
  full: '@[420px]:col-span-2 @[880px]:col-span-4',
};

/**
 * Das Raster eines Formularabschnitts (docs/MUSTER.md § J, Handoff Konsistenz § 8b.1): vier Spalten ab 880 px
 * Kartenbreite, zwei ab 420, darunter eine — so ist eine Spalte nie schmaler als rund 200 px, wie im
 * Vierer-Raster (HANDOFF Konsistenz § 8c). Gemessen wird die Karte (`@container`), nicht das Fenster — dasselbe
 * Formular steht so in einer Seite (1200), einem Dialog `lg` (760) und auf dem Telefon richtig. Die Felder
 * wählen ihre Spannweite über `FormField size`; eine Zeile darf unvoll bleiben.
 */
export function FormGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 @[420px]:grid-cols-2 @[880px]:grid-cols-4">{children}</div>
    </div>
  );
}

/** Erzwingt eine neue Zeile im `FormGrid`. Sparsam: Meist reicht die Reihenfolge in der Quelle. */
export function FormRowBreak() {
  return <div aria-hidden className="col-span-full h-0" />;
}

type FormCellProps<T extends ElementType> = { as?: T; size?: FieldSize; className?: string } & Omit<ComponentPropsWithoutRef<T>, 'as' | 'size' | 'className'>;

/**
 * Ein Element im `FormGrid`, das selbst kein `FormField` ist (Bildwähler, Zeilen-Editor, Hinweis, Vorschau), mit
 * derselben Spannweite wie `FormField size` (Standard `m`). `as` behält das Element (`fieldset`, `p`, `dl`, ein
 * Baustein wie `RadioGroup`); `className` und übrige Angaben gehen an das Element (HANDOFF Konsistenz § 8c).
 */
export function FormCell<T extends ElementType = 'div'>({ as, size = 'm', className, ...props }: FormCellProps<T>) {
  const Element: ElementType = as ?? 'div';
  return <Element {...props} className={cn(FIELD_SPAN[size], className)} />;
}
