import type { SiteJobKind } from '@kompass/module-site';
import type { OverviewView, SummaryView } from './site-job-view';

export const POLL_RUNNING_MS = 2_000;
export const POLL_IDLE_MS = 30_000;

/** Während etwas läuft alle 2 s, sonst selten — und bei einer misslungenen Abfrage ebenfalls selten. */
export const nextPollDelay = (overview: OverviewView | null): number => (overview?.running ? POLL_RUNNING_MS : POLL_IDLE_MS);

/**
 * Was zwischen zwei Abfragen geschah. `seen`: die Läufe, die dieser Tab
 * sichtbar laufen sah — nur für sie gibt es eine Meldung, nie für einen Lauf,
 * der vor dem Öffnen des Tabs endete. Ein Lauf zählt als beendet, sobald ein
 * neues Ergebnis seiner Art mit seiner Kennung da ist; verschwindet er nur aus
 * `running` (Neustart, das Ergebnis `interrupted` kommt erst beim nächsten
 * Lesen), bleibt es still, bis das Ergebnis da ist.
 */
export function transitions(prev: OverviewView | null, next: OverviewView, seen: ReadonlySet<string>): { started: boolean; finished: { kind: SiteJobKind; summary: SummaryView }[] } {
  const finished: { kind: SiteJobKind; summary: SummaryView }[] = [];
  for (const kind of Object.keys(next.last) as SiteJobKind[]) {
    const now = next.last[kind];
    if (now && seen.has(now.runId) && prev?.last[kind]?.runId !== now.runId) finished.push({ kind, summary: now });
  }
  return { started: !prev?.running && next.running !== null, finished };
}
