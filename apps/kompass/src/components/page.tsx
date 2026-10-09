import type { ReactNode } from 'react';
import { HydrationMarker } from '@/components/hydration-marker';
import { SectionLevel } from '@/components/section';
import { cn } from '@/lib/utils';

/**
 * Der Rahmen jeder Seite (docs/MUSTER.md § I, Handoff Konsistenz § 8a.2): Die Seite wählt ihre Breite, nicht
 * der Bereich, und sie gilt für Kopf und Inhalt zusammen — sonst stehen die Kopfaktionen weiter rechts als die
 * Speicherleiste. Linksbündig, ohne `mx-auto`: Die Schale hat links ihre Navigation, mittig sähe es verrutscht aus.
 *
 * - `task` 720: ein Vorgang in einer Spalte (Auslage, Umwidmung, Kasse)
 * - `standard` 1200: Formulare, Details, Einstellungen, Übersichten, Listen bis vier Spalten
 * - `full`: Listen ab fünf Spalten und Arbeitsflächen. Ohne eigenen Kasten (`contents`): Arbeitsflächen holen
 *   ihre Höhe aus dem Hauptbereich (`min-h-full`, `h-[calc(100%+3rem)]`), ein Block ohne Höhe dazwischen nähme
 *   sie ihnen (Handoff Konsistenz § 8c).
 *
 * Abschnitte stehen auf Ebene 2: Der Seitentitel im `PageHeader` ist das `h1` (Spec Seitenkopf § 2.2).
 */
export function Page({ width, header, children }: { width: 'task' | 'standard' | 'full'; header?: ReactNode; children?: ReactNode }) {
  return (
    <div data-page-width={width} className={cn(width === 'task' && 'max-w-task', width === 'standard' && 'max-w-standard', width === 'full' && 'contents')}>
      <SectionLevel level={2}>
        {header}
        {children}
      </SectionLevel>
      <HydrationMarker />
    </div>
  );
}
