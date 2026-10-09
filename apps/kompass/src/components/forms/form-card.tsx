import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type CardElement = 'div' | 'section' | 'form';

/**
 * Die Formularkarte (docs/MUSTER.md § E, Designer 2026-10-08): Rahmen, Fläche, Ecken — und `overflow-clip`, nie
 * `overflow-hidden`. Beide schneiden die Ecken der Speicherleiste, aber `hidden` macht die Karte zu einem
 * Scrollbereich, und eine klebende Leiste klebt dann an der Karte statt am Fenster: Sie klebte bis 0.2.9 auf den
 * meisten Formularseiten nie (Befund 39).
 *
 * Am Ende liegt eine unsichtbare Marke. Die `FormActionBar` darin beobachtet sie: Ist sie unter dem Fenster, klebt
 * die Leiste, und nur dann trägt sie einen Schatten.
 *
 * `as` wählt das Element: `section` für eine Karte mit Überschrift (`aria-labelledby`), `form` für ein Formular,
 * das selbst die Karte ist. Ein `ActionForm` steht dagegen innen — die Leiste liest den Stand vom `<form>`, nicht
 * von der Karte.
 */
export function FormCard<T extends CardElement = 'div'>({ as, className, children, ...props }: { as?: T } & ComponentProps<T>) {
  const Element = (as ?? 'div') as 'div';
  return (
    <Element data-slot="form-card" className={cn('relative overflow-clip rounded-lg border border-line bg-surface', className)} {...(props as ComponentProps<'div'>)}>
      {children}
      <div data-slot="form-card-end" aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px" />
    </Element>
  );
}

/** Der Inhalt der Karte mit dem Polster aus § E (20 px); die Speicherleiste steht danach, nicht darin. */
export function FormCardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5', className)} {...props} />;
}
