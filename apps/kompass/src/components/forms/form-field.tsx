import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FieldError } from './field-error';
import { FormCell } from './form-grid';

type FieldProps = { id?: string; children?: ReactNode; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' };

/**
 * Verbindet das Feld mit Hinweis und Meldung: Das Element mit `id` (direktes Kind oder unter einem
 * einfachen `div`) bekommt `aria-describedby` — die eigene des Aufrufers bleibt — und bei einem Fehler
 * `aria-invalid`. So liest ein Vorleser die Meldung beim Fokus, ohne dass jede Maske das selbst verdrahtet.
 */
function wire(node: ReactNode, id: string, describedBy: string, invalid: boolean): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<FieldProps>;
    if (element.props.id === id) {
      const own = element.props['aria-describedby'];
      return cloneElement(element, {
        'aria-describedby': [own, describedBy].filter(Boolean).join(' ') || undefined,
        ...(invalid ? { 'aria-invalid': true } : {}),
      });
    }
    // Nur durch einfache Elemente (`div`, `span`) und Fragmente hindurch, nie in fremde Bausteine hinein.
    if (typeof element.type === 'string' && element.props.children) {
      return cloneElement(element, undefined, wire(element.props.children, id, describedBy, invalid));
    }
    return child;
  });
}

/**
 * Spannweite im `FormGrid` (docs/MUSTER.md § J): `s` kurze Werte bis ~20 Zeichen (PLZ, Datum, Betrag, Nummern),
 * `m` Namen, E-Mail, Auswahl (Standard), `l` Langtext, `full` zusammengesetzte Felder. Außerhalb eines
 * `FormGrid` wirken die Klassen nicht.
 */
export type FieldSize = 's' | 'm' | 'l' | 'full';

export function FormField({
  id,
  label,
  hint,
  error,
  required,
  size = 'm',
  toggle = false,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  size?: FieldSize;
  /**
   * Schalter oder Haken: das Label neben dem Bedienelement, die Zeile so hoch wie ein Feld und unten bündig mit
   * den Eingabefeldern derselben Rasterzeile — ohne `pt-6`-Ausgleich an der Aufrufstelle.
   */
  toggle?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const showHint = Boolean(hint) && !error;
  const describedBy = error ? `${id}-error` : showHint ? `${id}-hint` : '';
  // Immer über `wire`, auch ohne Hinweis und Meldung: Wechselte der Baum mit der ersten Meldung, baute React
  // das Feld neu auf, und ein ungesteuertes Feld verlöre die Eingabe (form-field.test.tsx).
  const control = wire(children, id, describedBy, Boolean(error));
  return (
    <FormCell size={size} className={cn('flex flex-col gap-1.5', toggle && 'self-end', className)}>
      {toggle ? (
        <div className="flex h-[var(--field-h)] items-center gap-2.5">
          {control}
          <Label htmlFor={id} required={required} className="text-[14px] font-normal text-ink">{label}</Label>
        </div>
      ) : (
        <>
          <Label htmlFor={id} required={required} className="text-[13px] font-semibold text-ink-2">{label}</Label>
          {control}
        </>
      )}
      {showHint ? <p id={`${id}-hint`} className="text-[12px] text-muted-ink">{hint}</p> : null}
      <FieldError id={`${id}-error`} message={error} />
    </FormCell>
  );
}
