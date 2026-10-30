import { isModuleEnabled, type DbOrTx, type Deps } from '@kompass/core';
import type { FinanceFiscalYearRow, GovernedAssembly } from '@kompass/module-finance';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { minutesVersionsInternal } from '../minutes/signed';
import { governanceLabelText } from './labels';
import { governanceMeetings, governanceOrgans, governanceResolutions, type ResolutionRow } from '../schema';

type Outcome = 'granted' | 'refused' | 'postponed';
const OUTCOME: Record<string, Outcome | undefined> = { adopted: 'granted', rejected: 'refused', postponed: 'postponed' };
type Decided = { row: ResolutionRow; heldOn: string; meetingId: string };

/**
 * Quelle für Schritt 11 der Finanzen (Spec § 8.1, G7): das Ergebnis der **festgeschriebenen** Mitgliederversammlungen
 * zum Geschäftsjahr — Entlastung (`discharge`) und Genehmigung der Jahresrechnung (`accounts`). Eine nur beendete
 * Sitzung liefert nichts. Je Person gilt der jüngste Entlastungsbeschluss mit dem Tag seiner Sitzung (vertagt, dann in
 * der Wiederholungsversammlung erteilt) — außer nach einer erteilten (W-2); ein zurückgezogener zählt nicht. Ohne Gremien `null`. Schreibt nichts.
 */
export function governedAssemblyInternal(deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow, opts: { evenIfDisabled?: boolean } = {}): GovernedAssembly | null {
  // `evenIfDisabled`: nur für den Hinweis der Finanzen, dass Gremien das Ergebnis bisher führte (V-8).
  if (!opts.evenIfDisabled && !isModuleEnabled(deps, 'governance')) return null;
  const meetings = db
    .select({ id: governanceMeetings.id, heldOn: governanceMeetings.heldOn })
    .from(governanceMeetings)
    .innerJoin(governanceOrgans, eq(governanceOrgans.id, governanceMeetings.organId))
    .where(and(eq(governanceOrgans.kind, 'assembly'), isNotNull(governanceMeetings.sealedAt)))
    .all();
  if (meetings.length === 0) return null;
  const heldOn = new Map(meetings.map((m) => [m.id, m.heldOn]));
  const decided: Decided[] = db
    .select()
    .from(governanceResolutions)
    .where(and(inArray(governanceResolutions.meetingId, [...heldOn.keys()]), inArray(governanceResolutions.kind, ['discharge', 'accounts'])))
    .all()
    .filter((r) => (r.details as { fiscalYearId?: string } | null)?.fiscalYearId === year.id && r.outcome !== null && r.outcome !== 'withdrawn')
    .map((row) => ({ row, heldOn: heldOn.get(row.meetingId!)!, meetingId: row.meetingId! }))
    .sort((a, b) => a.heldOn.localeCompare(b.heldOn) || a.row.createdAt.localeCompare(b.row.createdAt));
  if (decided.length === 0) return null;

  const discharges = decided.filter((d) => d.row.kind === 'discharge');
  const accounts = decided.filter((d) => d.row.kind === 'accounts').at(-1);
  const latestDischarge = discharges.at(-1);
  const mode = (latestDischarge?.row.details as { mode?: 'individual' | 'collective' } | undefined)?.mode ?? 'individual';
  // W-2: Eine erteilte Entlastung wirkt als Verzicht — eine spätere Vertagung ändert nichts, eine spätere Verweigerung
  // überschreibt sie nicht still, sondern wird zum Hinweis.
  const warnings: 'dischargeRefusedAfterGranted'[] = [];
  const next = (before: Outcome | undefined, outcome: Outcome): boolean => {
    if (before !== 'granted' || outcome === 'granted') return true;
    if (outcome === 'refused' && !warnings.includes('dischargeRefusedAfterGranted')) warnings.push('dischargeRefusedAfterGranted');
    return false;
  };
  const perPerson = new Map<string, { outcome: Outcome; decidedOn: string; meetingId: string }>();
  let collective: Outcome | null = null;
  let collectiveMeetingId: string | null = null;
  for (const d of discharges) {
    const details = d.row.details as { mode: string; contactIds: string[] };
    const outcome = OUTCOME[d.row.outcome!];
    if (!outcome || details.mode !== mode) continue;
    if (mode === 'collective') {
      if (next(collective ?? undefined, outcome)) {
        collective = outcome;
        collectiveMeetingId = d.meetingId;
      }
      continue;
    }
    for (const contactId of details.contactIds) if (next(perPerson.get(contactId)?.outcome, outcome)) perPerson.set(contactId, { outcome, decidedOn: d.heldOn, meetingId: d.meetingId });
  }
  // W-15: die Protokolle aller Sitzungen, deren Entscheidung gilt (Genehmigung, je Person die Entlastung), nach Sitzungstag.
  const counted = new Set([accounts?.meetingId, collectiveMeetingId, ...[...perPerson.values()].map((p) => p.meetingId)].filter((m): m is string => !!m));
  const countedMeetings = meetings.filter((m) => counted.has(m.id)).sort((a, b) => a.heldOn.localeCompare(b.heldOn) || a.id.localeCompare(b.id));
  const minutesDocumentIds = countedMeetings.flatMap((m) => minutesVersionsInternal(db, m.id).at(-1)?.documentId ?? []);
  // K-2: Kopf, Tag und Protokoll aus der jüngsten Sitzung, deren Entscheidung gilt — nicht aus einer späteren, die nichts änderte.
  const head = countedMeetings.at(-1);
  const latest = head ? { meetingId: head.id, heldOn: head.heldOn } : decided.at(-1)!;
  return {
    source: { module: 'governance', meetingId: latest.meetingId, label: governanceLabelText(deps, 'governanceMeeting', latest.meetingId) ?? latest.heldOn, href: `/governance/meetings/${latest.meetingId}` },
    assemblyOn: latest.heldOn,
    minutesDocumentId: minutesVersionsInternal(db, latest.meetingId).at(-1)?.documentId ?? null,
    minutesDocumentIds,
    accountsApproved: accounts ? (accounts.row.outcome === 'adopted' ? 'yes' : accounts.row.outcome === 'rejected' ? 'no' : 'notVoted') : 'notVoted',
    dischargeMode: mode,
    collectiveOutcome: mode === 'collective' ? collective : null,
    discharges: [...perPerson].map(([contactId, v]) => ({ contactId, outcome: v.outcome, decidedOn: v.decidedOn })),
    warnings,
  };
}
