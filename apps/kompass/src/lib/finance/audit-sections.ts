import type { AuditSection } from '@kompass/module-finance';

/**
 * Die acht Abschnitte des Prüfpakets in Prüferreihenfolge, für Client-Komponenten (das Modul selbst gehört nicht ins
 * Bündel des Browsers). Der Typ hält die Liste vollständig: Fehlt ein Abschnitt, schlägt `Missing` fehl.
 */
export const AUDIT_SECTION_ORDER = ['journal', 'reconciliation', 'vouchers', 'imports', 'anomalies', 'purposesReserves', 'donations', 'partnerPayments'] as const satisfies readonly AuditSection[];
type Missing = Exclude<AuditSection, (typeof AUDIT_SECTION_ORDER)[number]>;
const complete: Missing extends never ? true : never = true;
void complete;

export const isAuditSection = (value: string): value is AuditSection => (AUDIT_SECTION_ORDER as readonly string[]).includes(value);

/** Zeilen je Seite einer Abschnittsseite (MUSTER § L: blättert zu 50). */
export const SECTION_PAGE_SIZE = 50;
