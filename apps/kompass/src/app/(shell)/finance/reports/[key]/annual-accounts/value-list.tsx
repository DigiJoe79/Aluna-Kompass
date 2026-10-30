import type { ReactNode } from 'react';

/**
 * Wertliste der Jahresrechnung („Zur Kontrolle“, „Auf einen Blick“): je Zeile Name links, Wert rechts mit
 * `tabular-nums`, Trenner `line-2` — wie die Bestände im Journal (`finance/entries/side-panel.tsx`). Kein Baustein unter
 * `src/components/` (Plan U1, Spec § Bausteine „Wertliste“).
 */
export function ValueList({ rows }: { rows: { key: string; label: ReactNode; value: ReactNode; detail?: ReactNode }[] }) {
  return (
    <dl className="border-t border-line-2">
      {rows.map((row) => (
        <div key={row.key} data-testid={`value-${row.key}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-line-2 py-2">
          <dt className="text-meta text-ink-2">{row.label}</dt>
          <dd className="text-right text-body tabular-nums">{row.value}</dd>
          {row.detail ? <dd className="col-span-2 text-hint text-muted-ink">{row.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
