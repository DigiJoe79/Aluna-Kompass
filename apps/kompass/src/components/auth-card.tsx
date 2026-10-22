import type { ReactNode } from 'react';
import { HydrationMarker } from '@/components/hydration-marker';
import { cn } from '@/lib/utils';

/**
 * Die Ersatzmarke, solange kein Vereinslogo hinterlegt ist — dieselbe auf der Anmeldung und in der Kopfleiste
 * (01 C26). `small` ist die Größe der Kopfleiste (26 px statt 34 px).
 */
export function FallbackMark({ small = false }: { small?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border border-brand bg-brand-soft font-heading font-bold text-brand-ink',
        small ? 'size-[26px] rounded-sm text-[11px]' : 'size-[34px] text-[15px]',
      )}
    >
      AK
    </div>
  );
}

/**
 * Anmeldung, Passwort und Einrichtung: eine Kopfzeile und eine Kartenbreite (01 C27); der Fußtext ist nie breiter
 * als die Karte und bricht ausgewogen um (01 C28). Kein Layout-Test (AGENTS.md).
 */
export function AuthCard({ brand, organization, title, width = 400, children, footer }: { brand: string; organization?: string; title: string; width?: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg p-6">
      <div className="flex items-center gap-3">
        <FallbackMark />
        <div>
          {organization ? <div className="text-section">{organization}</div> : null}
          <div className={organization ? 'text-hint text-muted-ink' : 'font-heading text-[18px]'}>{brand}</div>
        </div>
      </div>
      <section style={{ width }} className="flex max-w-full flex-col gap-5 rounded-lg border border-line bg-surface p-7 shadow-sm">
        <h1 className="font-heading text-page-title">{title}</h1>
        {children}
      </section>
      {footer ? <p style={{ width }} className="max-w-full text-balance text-center text-meta text-muted-ink">{footer}</p> : null}
      <HydrationMarker />
    </main>
  );
}
