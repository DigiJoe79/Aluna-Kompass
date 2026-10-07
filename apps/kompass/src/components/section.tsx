'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type SectionLevelValue = 2 | 3 | 4;

const LevelContext = createContext<SectionLevelValue | null>(null);

/**
 * Die Ebene der Abschnitte darunter (K10, Designer 2026-10-07): `Page` setzt 3 (der Seitentitel ist ein h2,
 * der h1 steht in der Brotkrume), `DialogContent` und `SheetContent` setzen ebenfalls 3. Ein Dialog muss sie selbst setzen — der Kontext der Seite reicht durch das Portal.
 */
export function SectionLevel({ level, children }: { level: SectionLevelValue; children: ReactNode }) {
  return <LevelContext.Provider value={level}>{children}</LevelContext.Provider>;
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
  children,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  level?: SectionLevelValue;
  children: ReactNode;
}) {
  const outer = useContext(LevelContext);
  const own: SectionLevelValue = level ?? outer ?? 2;
  const inner: SectionLevelValue = own === 2 ? 3 : 4;
  const Heading = `h${own}` as const;
  return (
    <section className="[&+&]:mt-5 [&+&]:border-t [&+&]:border-line [&+&]:pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <Heading className="font-heading text-section text-ink">{title}</Heading>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {intro ? <div className="mt-1 text-meta text-ink-2">{intro}</div> : null}
      <div className="mt-3">
        <SectionLevel level={inner}>{children}</SectionLevel>
      </div>
    </section>
  );
}
