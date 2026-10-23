'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Unit = string | { one: string; other: string };

/**
 * Zählfeld (N1, Designer 2026-10-23 `zaehlfelder`; MUSTER § E „Einheit im Feld“): eine kleine ganze Zahl („7 tägliche“,
 * „30 Tage“). Der Rahmen ist überall gleich breit, die Zahl steht rechtsbündig darin, die Einheit als Text dahinter —
 * nicht auf grauer Fläche im Rahmen, die bleibt den Beträgen. So sind alle Rahmen gleich lang, wie lang das Wort auch ist.
 * Ohne Pfeile (Joe 2026-10-23): Chrome hielte ihnen Platz frei, die Zahl stünde dann in der Mitte; Pfeiltasten zählen
 * weiter. Die Einheit beschreibt das Feld für Vorleser; `{ one, other }` wählt die Form nach dem Wert („1 Tag“, „28 Tage“).
 */
export function CountField({ id, unit, className, value, defaultValue, 'aria-describedby': describedBy, ...props }: Omit<React.ComponentProps<'input'>, 'type'> & { id: string; unit?: Unit }) {
  const current = Number(value ?? defaultValue);
  const word = unit === undefined ? null : typeof unit === 'string' ? unit : current === 1 ? unit.one : unit.other;
  const unitId = `${id}-unit`;
  const describe = [word === null ? null : unitId, describedBy].filter(Boolean).join(' ') || undefined;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Input id={id} type="number" inputMode="numeric" step={1} value={value} defaultValue={defaultValue} aria-describedby={describe} className="w-20 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" {...props} />
      {word === null ? null : (
        <span id={unitId} className="whitespace-nowrap text-body text-ink-2">
          {word}
        </span>
      )}
    </span>
  );
}
