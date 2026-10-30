/** Werte einer Gremienfrist für den Satz: ISO-Tage über die Datumsanzeige der Oberfläche (MUSTER § Datum), Rest wie geliefert. */
export function deadlineValues(params: Record<string, string | number>, date: (iso: string) => string): Record<string, string | number> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? date(v) : v]));
}
