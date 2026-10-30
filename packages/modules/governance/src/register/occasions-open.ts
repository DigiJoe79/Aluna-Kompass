import type { DbOrTx } from '@kompass/core';
import { addCalendarDays } from '@kompass/module-finance';
import { governanceOffices, governanceRegisterOccasions, governanceStatutes, governanceTerms, type OccasionKind, type OccasionRow } from '../schema';
import { statuteCoveredInternal, statuteValidOnInternal } from '../statutes';
import { termScheduledEnd } from '../term-schedule';

/** Ein offener Anlass zur Registeranmeldung: gespeichert (`id`) oder berechnet (`id: null`, abgelaufene Amtszeit). */
export interface OpenOccasion {
  id: string | null;
  kind: OccasionKind;
  occurredOn: string;
  termId: string | null;
  officeId: string | null;
  statuteId: string | null;
  meetingId: string | null;
  resolutionId: string | null;
}

const fromRow = (o: OccasionRow): OpenOccasion => ({ id: o.id, kind: o.kind, occurredOn: o.occurredOn, termId: o.termId, officeId: o.officeId, statuteId: o.statuteId, meetingId: o.meetingId, resolutionId: o.resolutionId });

/**
 * Die offenen Anlässe am Tag `today` (Spec § 6, § 7.1): gespeicherte ohne Anmeldung und — berechnet, nie gespeichert
 * (Prinzip 5) — jede Amtszeit eines vertretenden Amts **ohne** „bis zur Neuwahl“, deren planmäßiges Ende vor `today`
 * liegt und die keine Nachfolge hat (eine Inhaberschaft desselben Amts, die spätestens am Tag nach dem Ende beginnt).
 * Der berechnete Anlass liegt am Tag nach dem Ende (§ 67 BGB: jede Änderung des Vorstands). Wer ihn schon als Zeile
 * führt (gebündelt oder vom Rücktritt), bekommt keinen zweiten. Dazu berechnet ein beschlossener Satzungsstand ohne
 * Eintragung (G-15).
 */
export function openOccasionsInternal(db: DbOrTx, today: string): OpenOccasion[] {
  const stored = db.select().from(governanceRegisterOccasions).all();
  const open = stored.filter((o) => o.filingId === null).map(fromRow);
  const offices = new Map(db.select().from(governanceOffices).all().map((o) => [o.id, o]));
  const terms = db.select().from(governanceTerms).all();
  for (const term of terms) {
    const office = offices.get(term.officeId);
    if (!office?.representative || office.untilSuccessor) continue;
    const end = termScheduledEnd(term, office);
    if (end === null || end >= today) continue;
    const next = addCalendarDays(end, 1);
    if (terms.some((t) => t.id !== term.id && t.officeId === term.officeId && t.since > term.since && t.since <= next)) continue;
    if (stored.some((o) => o.termId === term.id && o.occurredOn >= end)) continue;
    open.push({ id: null, kind: 'boardChange', occurredOn: next, termId: term.id, officeId: office.id, statuteId: null, meetingId: null, resolutionId: null });
  }
  // G-15 (Spec § 7.1): ein beschlossener, nicht eingetragener Satzungsstand — auch von Hand nachgetragen —, sobald der
  // Verein eingetragen ist (vorher deckt die Ersteintragung ihn ab) und kein gültiger oder eingetragener Stand auf ihm
  // aufbaut (W-1: ein später eingetragener Stand ohne seine Änderungen erledigt ihn nicht).
  const statutes = db.select().from(governanceStatutes).all();
  const current = statuteValidOnInternal(db, today);
  const registeredOn = statutes.map((s) => s.registeredOn).filter((d): d is string => d !== null);
  for (const statute of statutes) {
    const resolvedOn = statute.resolutions.map((r) => r.on).sort().at(-1);
    if (!resolvedOn || statute.registeredOn !== null || registeredOn.length === 0) continue;
    if (statuteCoveredInternal(statutes, statute, current, today)) continue;
    if (stored.some((o) => o.statuteId === statute.id)) continue;
    open.push({ id: null, kind: 'statute', occurredOn: resolvedOn, termId: null, officeId: null, statuteId: statute.id, meetingId: null, resolutionId: null });
  }
  return open.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || (a.id ?? '').localeCompare(b.id ?? ''));
}

