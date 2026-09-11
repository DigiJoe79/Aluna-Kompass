import * as React from 'react';
import { cn } from 'cn';

/**
 * Auswahlfeld. Bewusst das native `<select>`: Es trägt die Tastatur- und
 * Vorlesebedienung des Systems, funktioniert ohne Hydration und lässt sich
 * in Formularen wie jedes andere Feld absenden. Höhe, Rand und Fokus kommen
 * aus derselben Quelle wie bei `Input` und `Textarea`.
 */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-[var(--field-h)] w-full rounded-md border border-line-strong bg-field px-2.5 text-sm text-ink transition-colors',
        'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-ink',
        'aria-invalid:border-error',
        className
      )}
      {...props}
    />
  );
}

export { Select };
