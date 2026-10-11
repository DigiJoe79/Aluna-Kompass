'use client';

import { createContext, useContext, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';

export type SectionLevelValue = 2 | 3 | 4;

const LevelContext = createContext<SectionLevelValue | null>(null);

/**
 * Die Ebene der Abschnitte darunter (K10, Designer 2026-10-07): `Page` setzt 2 (der Seitentitel im `PageHeader`
 * ist das h1), `DialogContent` und `SheetContent` setzen 3 (`DialogTitle` ist h2). Ein Dialog muss sie selbst setzen — der Kontext der Seite reicht durch das Portal.
 */
export function SectionLevel({ level, children }: { level: SectionLevelValue; children: ReactNode }) {
  return <LevelContext.Provider value={level}>{children}</LevelContext.Provider>;
}

/** Die Ebene aus dem Umfeld, `null` ohne Umfeld — für Bausteine, deren Überschrift sich danach richtet. */
export function useSectionLevel(): SectionLevelValue | null {
  return useContext(LevelContext);
}

/**
 * Jede Überschrift in der Rolle Abschnitt (K10 Charge 3, Designer § 9.4): Serife, 15/600, Ebene aus dem Umfeld.
 * Nutzer: `Section`, `EmptyState`, `BlockedState`, der Ordnertitel der Akte. `ref` macht sie zum Fokusziel
 * (nach einem Laufwechsel), dann ohne Fokusring, weil der Fokus nur die Ansage trägt.
 */
export function SectionHeading({ children, id, ref, level }: { children: ReactNode; id?: string; ref?: Ref<HTMLHeadingElement>; level?: SectionLevelValue }) {
  const outer = useContext(LevelContext);
  const own: SectionLevelValue = level ?? outer ?? 2;
  const Heading = `h${own}` as const;
  return (
    <Heading id={id} ref={ref} tabIndex={ref ? -1 : undefined} className={cn('font-heading text-section text-ink', ref && 'outline-none')}>
      {children}
    </Heading>
  );
}

/**
 * Ein Abschnitt in Formular, Dialog oder Panel (docs/MUSTER.md § E; K10, Designer und Joe 2026-10-06).
 * Die Überschriftenebene kommt aus dem Umfeld (ohne Umfeld 2), eine verschachtelte `Section` zählt eins
 * hoch, höchstens 4; `level` übersteuert nur als Ausnahme. Linie und Abstand zum Vorgänger setzt `[&+&]` —
 * also nur, wenn direkt davor ebenfalls eine `Section` steht; ein Hinweis oder Wrapper dazwischen
 * unterbricht die Linie (gewollt).
 */
export function Section({
  title,
  intro,
  actions,
  level,
  headingId,
  headingRef,
  children,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  level?: SectionLevelValue;
  /** Für `aria-labelledby` an einer Stelle außerhalb des Abschnitts; ohne sichtbare Wirkung. */
  headingId?: string;
  /** Fokusziel nach einem Laufwechsel (setzt `tabIndex={-1}`, ohne Fokusring); ohne sichtbare Wirkung. */
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  const outer = useContext(LevelContext);
  const own: SectionLevelValue = level ?? outer ?? 2;
  const inner: SectionLevelValue = own === 2 ? 3 : 4;
  return (
    <section className="[&+&]:mt-5 [&+&]:border-t [&+&]:border-line [&+&]:pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <SectionHeading level={own} id={headingId} ref={headingRef}>
          {title}
        </SectionHeading>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {intro ? <div className="mt-1 text-meta text-ink-2">{intro}</div> : null}
      <div className="mt-3">
        <SectionLevel level={inner}>{children}</SectionLevel>
      </div>
    </section>
  );
}
