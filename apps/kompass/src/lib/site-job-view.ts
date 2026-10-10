import type { ServiceError } from '@kompass/core';
import type { PendingChange, SiteJobDetail, SiteJobKind, SiteJobRunView, SiteJobSummary } from '@kompass/module-site';
import { toActionState } from './actions';

/** Die Formen, die `/site/job` und `/site/job/[kind]` an den Browser geben. Fehler kommen schon übersetzt. */
export type ViewError = { code: string; message: string };
export type SummaryView = Omit<SiteJobSummary, 'error'> & { error?: ViewError };
export type DetailView = Omit<SiteJobDetail, 'error'> & { error?: ViewError };
export interface OverviewView {
  running: SiteJobRunView | null;
  last: Record<SiteJobKind, SummaryView | null>;
  /** Was seit dem letzten Publish der Produktion öffentlich anders ist (Plan C); null ohne `site.publish`. */
  pending?: PendingView | null;
}

/** So viele Namen zeigt das Menü der Kopfzeile (Board Vorschläge 8a). */
export const PENDING_MENU_ITEMS = 5;
export interface PendingView {
  since: string | null;
  count: number;
  /** Die ersten fünf, nach Name. */
  items: PendingChange[];
  /** Adressen aller betroffenen Datensätze (auch der von der Webseite genommenen) — für die Zeile am Datensatz. */
  hrefs: string[];
  /** Namen aller geänderten Variablen der Webseite — für die eine Zeile der Variablen-Seite (Designer 2026-10-10). */
  variables: string[];
}

/** Die Variablen teilen sich eine Seite; ihre Einträge erkennt man am Schlüssel `variables.<name>` (`public-content.ts`). */
export const pendingVariableNames = (items: readonly PendingChange[]): string[] => items.filter((i) => i.key.startsWith('variables.')).map((i) => i.label);

type Translate = Parameters<typeof toActionState>[1];

/** `code` ist der Konfliktcode, sonst die Fehlerart; `message` derselbe Satz, den eine Server Action melden würde. */
export function viewError(error: ServiceError, t: Translate): ViewError {
  const state = toActionState({ ok: false, error }, t) as { message: string };
  return { code: error.type === 'conflict' ? error.code : error.type, message: state.message };
}

/** Eine Antwort ohne Rumpf für Fehler, wie sie die anderen Lese-Routen geben. */
export const failureStatus = (error: ServiceError): number => (error.type === 'forbidden' ? 403 : error.type === 'validation' || error.type === 'notFound' ? 404 : 500);

export function viewSummary<T extends { error?: ServiceError }>(summary: T | null, t: Translate): (Omit<T, 'error'> & { error?: ViewError }) | null {
  if (!summary) return null;
  const { error, ...rest } = summary;
  return { ...rest, ...(error ? { error: viewError(error, t) } : {}) };
}
