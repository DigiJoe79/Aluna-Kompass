import type { ReactNode } from 'react';

/**
 * Leiste für eine Mehrfachauswahl in einer Liste (MUSTER.md § G). Klebt unten,
 * damit die Aktionen bei langen Listen erreichbar bleiben. Die Live-Region
 * steht immer im DOM: Eine Region sagt nur an, was in ihr geschieht, nachdem
 * sie da ist — erscheint sie erst mit der Auswahl, schweigt der Vorleser.
 */
export function SelectionBar({ count, label, children }: { count: number; label: string; children: ReactNode }) {
  return (
    <>
      <span data-testid="selection-live" role="status" className="sr-only">
        {count > 0 ? label : ''}
      </span>
      {count > 0 ? (
        <div
          data-testid="selection-bar"
          role="toolbar"
          aria-label={label}
          className="sticky bottom-0 z-10 mt-3 flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-2.5 shadow-md max-sm:flex-col max-sm:items-stretch"
        >
          <span aria-hidden className="text-[13px] font-semibold text-ink">
            {label}
          </span>
          <div className="ml-auto flex items-center gap-2 max-sm:ml-0 max-sm:flex-col max-sm:items-stretch max-sm:[&>*]:w-full">{children}</div>
        </div>
      ) : null}
    </>
  );
}
