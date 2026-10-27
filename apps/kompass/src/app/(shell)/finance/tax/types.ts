import type { TaxPeriodView } from '@kompass/module-finance';

/** Was die Seite „Steuererklärung“ über die Zeiträume, Jahre und Rechte braucht — vom Server einmal gebildet. */

export interface TaxYear {
  id: string;
  designation: string;
  startsOn: string;
  endsOn: string;
}

/** Ein Zeitraum als Option im Rahmen „Zeitraum“ (13g): Zustand mit Tag. */
export interface TaxPeriodOption {
  id: string;
  label: string;
  state: TaxPeriodView['state'];
  dueOn: string;
  filedOn: string | null;
  noticeOn: string | null;
}

/** Vorschläge der Frist je Geschäftsjahr als letztem Jahr (`suggestedDueOn`): ohne und mit Steuerberatung. */
export type DueSuggestions = Record<string, { plain: string; advisor: string }>;

export interface TaxMe {
  /** `finance.periodClose`: Zeitraum, Angaben, Abgabe, Dokumente, Bescheid. */
  canEdit: boolean;
  /** `finance.reportsFinalize`. */
  canFinalize: boolean;
  /** `finance.entriesWrite`: Steuerdaten von Empfänger und Geber. */
  canWriteEntries: boolean;
  /** Sieht die Akte: Dokumente aus ihr wählen. */
  canPickDocument: boolean;
}

/** Der gezeigte Zeitraum (13g): der aus der Adresse, sonst der neueste offene, sonst der neueste. Zeiträume neuester zuerst. */
export function choosePeriod<P extends { id: string; state: string }>(periods: readonly P[], wanted: string | undefined): P | null {
  return periods.find((p) => p.id === wanted) ?? periods.find((p) => p.state === 'open') ?? periods[0] ?? null;
}
