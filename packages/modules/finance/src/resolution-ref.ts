import { invalid, resolveRecordLabel, type CallContext, type Deps, type Failure } from '@kompass/core';
import { resolutionFactsOf } from './sources';

/** Ein Beschluss eines anderen Moduls (Gremien), wie Rücklage und Beitragsordnung ihn zeigen: Beschriftung und Link. */
export interface ResolutionReference {
  label: string;
  href: string | null;
}

/**
 * G7: der Beschluss hinter einer ID — über `resolveRecordLabel` (`governanceResolution`), ohne die Gremien zu kennen.
 * `null`, wenn kein eingeschaltetes Modul ihn kennt (Gremien aus, unbekannte ID). Ohne Leserecht die neutrale
 * Beschriftung, die der Haken liefert.
 */
export function resolutionReferenceInternal(deps: Deps, ctx: CallContext, resolutionId: string | null): ResolutionReference | null {
  if (!resolutionId) return null;
  const label = resolveRecordLabel(deps, ctx, 'governanceResolution', resolutionId);
  if (!label || label.state === 'missing') return null;
  return { label: label.label, href: label.href };
}

/**
 * Was ein Verweis verlangt: genau eine Art (`reserve`, `feeSchedule`) oder — für die Partnerzahlung — jede Art außer den
 * genannten, unter einem Namen für die Meldung (`expected`).
 */
export type ResolutionKindRule = string | { expected: string; except: readonly string[] };

/** Partnerzahlung (G7): jeder Beschluss, der eine Ausgabe tragen kann — nicht Entlastung, Jahresrechnung, Wahl, Abberufung. */
export const PARTNER_PAYMENT_RESOLUTION: ResolutionKindRule = { expected: 'partnerPayment', except: ['discharge', 'accounts', 'election', 'dismissal'] };

/**
 * Prüft eine angegebene Beschluss-ID: unbekannt → `resolutionUnknown`; nicht festgeschrieben oder nicht angenommen →
 * `resolutionNotFinal`; andere Art als `kind` (`reserve`, `feeSchedule`) bzw. eine ausgeschlossene → `resolutionWrongKind`
 * (V-3). Alles als `validation` am Feld `resolutionId`.
 */
export function resolutionIdProblem(deps: Deps, ctx: CallContext, resolutionId: string | null | undefined, kind: ResolutionKindRule): Failure | null {
  if (!resolutionId) return null;
  const facts = resolutionReferenceInternal(deps, ctx, resolutionId) ? resolutionFactsOf(deps, deps.db, resolutionId) : null;
  if (!facts) return invalid([{ path: 'resolutionId', message: 'resolutionUnknown' }]);
  if (!facts.final || facts.outcome !== 'adopted') return invalid([{ path: 'resolutionId', message: 'resolutionNotFinal' }]);
  // K-9: Die Meldung nennt nur die erwartete Art (Rücklage oder Beitragsordnung), nicht beide.
  const wrong = typeof kind === 'string' ? facts.kind !== kind : kind.except.includes(facts.kind);
  if (wrong) return invalid([{ path: 'resolutionId', message: 'resolutionWrongKind', params: { expected: typeof kind === 'string' ? kind : kind.expected } }]);
  return null;
}
