import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';

/**
 * `back` steht über dem Titel, nicht neben den Aktionen: Es führt aus der Seite
 * heraus und gehört damit nicht zu dem, was man auf ihr tun kann. Seiten, die
 * man über die Navigation erreicht, lassen es weg — der Wächter dazu steht in
 * `tests/back-navigation.test.ts`.
 *
 * Der Titel ist das einzige `h1` der Seite (Spec Seitenkopf § 2.2); die Brotkrume darüber ist Navigation.
 * Wächter `tests/patterns/one-h1.test.ts`.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  status,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /**
   * Zustand des Datensatzes (archiviert, inaktiv) — nur eine `StatusBadge` (Freigabe Designer 2026-10-08, Wächter
   * `record-action-placement`). Rechts neben dem `h1` auf der Grundlinie, 10 px Abstand, am Telefon darunter; nicht
   * Teil des `h1`, damit der Seitentitel der Name bleibt.
   */
  status?: ReactElement;
}) {
  return (
    <div className="mb-5">
      {back ? (
        <Link
          href={back.href}
          className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} -ml-2 mb-1`}
        >
          <span aria-hidden>←</span>
          {back.label}
        </Link>
      ) : null}
      {/* Telefon (`max-sm`): Titel und Aktionen untereinander, die Aktionen brechen um — nebeneinander drückten
          „Als PDF“ und das Blättern die Tieradresse in eine Spalte von wenigen Zeichen (release-0.2.7.md,
          Befund 15). Ab 640 px wie bisher nebeneinander. Kein Layout-Test für diese Einzelstelle. */}
      <div className="flex items-start justify-between gap-4 max-sm:flex-col max-sm:gap-3">
        {/* `min-w-0` und `break-words`: Eine lange Adresse in der Beschreibung (Tier) schob auf dem Telefon die Kopfaktionen
            23 px über die Inhaltskante (Abnahme K8/K9, 390 px). Kein Layout-Test für diese Einzelstelle. */}
        <div className="min-w-0">
          {title ? (
            // Mit `status`: Marke auf der Grundlinie des Titels, 10 px Abstand; Telefon darunter. Ohne `status` derselbe
            // Aufbau, damit der Titel nicht springt, wenn ein Datensatz archiviert wird.
            <div className="flex items-baseline gap-2.5 max-sm:flex-col max-sm:items-start max-sm:gap-1">
              <h1 className="font-heading text-[22px] tabular-nums">{title}</h1>
              {status}
            </div>
          ) : null}
          {description ? <p className="mt-1 text-[14px] break-words text-ink-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2 max-sm:flex-wrap">{actions}</div> : null}
      </div>
    </div>
  );
}
