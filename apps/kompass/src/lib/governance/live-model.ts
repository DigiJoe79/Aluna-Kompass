import type { AgendaItemView, ElectionDetails, ElectionView, MotionView, ResolutionView } from '@kompass/module-governance';
import type { VoteTallyValue } from '@/components/governance/vote-tally';

export type SummaryKey = 'unanimous' | 'adopted' | 'rejected' | 'postponed' | 'withdrawn' | 'noted' | 'elected' | 'counted' | 'lateMotion';
export interface ItemSummary {
  summary: { key: SummaryKey; name?: string } | null;
  done: boolean;
  mark: 'reasonMissing' | 'againstCount' | null;
}
type AnyResolution = ResolutionView | ElectionView;

const NOTE_KINDS = ['report', 'discussion', 'other'];

/**
 * Was die Sprungliste je Punkt sagt (Plan U1 Task 9, Board 1a/1b): Ergebnis in einer Unterzeile, erledigt, sobald jedes
 * Ergebnis festgestellt ist (Wahl: angenommen), und höchstens eine Marke — „Begründung fehlt“ (der Dienst meldet
 * `reasonMissing`, oder die Feststellung wartet noch im Browser) vor „gegen die Zählung“.
 */
export function itemSummary(item: AgendaItemView, resolutions: readonly AnyResolution[], names: Record<string, string>, pendingReason: boolean): ItemSummary {
  const own = resolutions.filter((r) => r.agendaItemId === item.id);
  const reasonMissing = pendingReason || own.some((r) => (r.warnings as string[]).includes('reasonMissing'));
  const against = own.some((r) => (r.warnings as string[]).includes('outcomeAgainstCount'));
  const mark = reasonMissing ? 'reasonMissing' : against ? 'againstCount' : null;
  if (own.length === 0) {
    const noted = NOTE_KINDS.includes(item.kind) && !!item.minutesNote?.trim();
    return { summary: noted ? { key: 'noted' } : null, done: noted, mark: null };
  }
  const elections = own.filter((r) => r.kind === 'election');
  if (elections.length > 0) {
    const accepted = elections.flatMap((r) => (r.details as ElectionDetails | null)?.elected.filter((e) => e.acceptedOn && !e.declinedOn) ?? []);
    const first = accepted[0];
    return { summary: first ? { key: 'elected', name: names[first.contactId] ?? '' } : null, done: accepted.length > 0 && elections.every((r) => (r.details as ElectionDetails | null)?.elected.some((e) => e.acceptedOn)), mark };
  }
  const last = own.at(-1)!;
  const allDecided = own.every((r) => r.outcome !== null);
  const summary: ItemSummary['summary'] = last.outcome === null ? (last.votes ? { key: 'counted' } : null) : last.unanimous && last.outcome === 'adopted' ? { key: 'unanimous' } : { key: last.outcome };
  return { summary, done: allDecided && !reasonMissing, mark };
}

export interface LiveEntry {
  key: string;
  number: string;
  title: string;
  summary: ItemSummary['summary'];
  done: boolean;
  mark: ItemSummary['mark'];
  /** Antrag nach Frist ohne TOP: Abstimmung über die Aufnahme. */
  lateMotion: boolean;
}

/**
 * Die Einträge der Sprungliste: die Tagesordnung, danach jeder Antrag ohne TOP (`motion:<id>`), der nach Frist kam oder
 * aus der Versammlung (mit offener Abstimmung über die Aufnahme), über dessen Aufnahme abgestimmt wird (Spec § 5.3). Zurückgezogene fallen weg.
 */
export function liveEntries(agenda: readonly AgendaItemView[], resolutions: readonly AnyResolution[], motions: readonly MotionView[], names: Record<string, string>, pendingReasons: ReadonlySet<string>): LiveEntry[] {
  const entries: LiveEntry[] = agenda.map((item) => {
    const s = itemSummary(item, resolutions, names, pendingReasons.has(item.id));
    return { key: item.id, number: String(item.position), title: item.title, summary: s.summary, done: s.done, mark: s.mark, lateMotion: false };
  });
  let n = agenda.length;
  for (const motion of motions) {
    if (motion.agendaItemId || motion.withdrawnOn) continue;
    const admission = resolutions.find((r) => r.kind === 'agenda' && (r.details as { motionId?: string } | null)?.motionId === motion.id);
    // Ein Antrag aus der Versammlung ohne Antragsfrist ist nicht „nach Frist“, trägt aber seine offene Abstimmung.
    if (!motion.late && !admission) continue;
    n += 1;
    const decided = admission?.outcome ?? null;
    entries.push({
      key: `motion:${motion.id}`,
      number: String(n),
      title: motion.text.slice(0, 120),
      summary: decided ? { key: decided } : { key: 'lateMotion' },
      done: decided !== null,
      mark: pendingReasons.has(`motion:${motion.id}`) || (admission?.warnings as string[] | undefined)?.includes('reasonMissing') ? 'reasonMissing' : null,
      lateMotion: true,
    });
  }
  return entries;
}

/** Geht jemand während einer Zählung mit errechnetem Ja, rechnet Kompass neu (Abnahme 8); von Hand gezählt bleibt. */
export function recountAfterDeparture(value: VoteTallyValue): boolean {
  return value.mode === 'counting' && value.yes === null && value.outcome !== 'postponed' && value.outcome !== 'withdrawn';
}

/** Der Stand der Ergebnis-Karte aus einem gespeicherten Beschluss. */
export function tallyValueOf(r: ResolutionView | null): VoteTallyValue {
  if (!r) return { mode: 'idle', no: 0, abstain: 0, invalid: 0, yes: null, outcome: null, reason: '', recountNote: null };
  const v = r.votes;
  const closed = r.outcome === 'postponed' || r.outcome === 'withdrawn';
  return {
    mode: r.unanimous ? 'unanimous' : v && !closed ? 'counting' : 'idle',
    no: v?.no ?? 0,
    abstain: v?.abstain ?? 0,
    invalid: v?.invalid ?? 0,
    yes: v && !r.yesComputed ? v.yes : null,
    outcome: r.outcome,
    reason: r.outcomeReason ?? '',
    recountNote: null,
  };
}

type PresentLike = { voting: number; votingContactIds: string[] };
type DischargeDetails = { fiscalYearId: string; mode: 'individual' | 'collective'; contactIds: string[] };

/** Die Entlastungsbeschlüsse eines TOP in der Reihenfolge der Betroffenen. */
function dischargesOf(resolutions: readonly AnyResolution[], itemId?: string): ResolutionView[] {
  return resolutions.filter((r): r is ResolutionView => r.kind === 'discharge' && (itemId === undefined || r.agendaItemId === itemId));
}

/** Einzeln je Person „5a“, „5b“ … in der Reihenfolge der Beschlüsse; gemeinsam die Nummer des TOP (Board 1e). */
export function dischargeLabels(resolutions: readonly AnyResolution[], itemNumber: number): Record<string, string> {
  const discharges = dischargesOf(resolutions);
  const individual = discharges.length > 1 || (discharges[0]?.details as DischargeDetails | null)?.mode === 'individual';
  return Object.fromEntries(discharges.map((r, i) => [r.id, individual ? `${itemNumber}${String.fromCharCode(97 + i)}` : String(itemNumber)]));
}

/**
 * Die Zahl für die Lageleiste bei einer Entlastung (Abnahme 7): stimmberechtigt Anwesende ohne die anwesenden
 * Betroffenen des Beschlusses — Abwesende werden nicht abgezogen (wie `excludedPresent` im Dienst). Sonst `null`.
 */
export function scopeOf(item: AgendaItemView, resolutions: readonly AnyResolution[], present: PresentLike, resolutionId: string | null): { itemNumber: number; present: number } | null {
  if (item.kind !== 'discharge') return null;
  const own = dischargesOf(resolutions, item.id);
  const r = own.find((x) => x.id === resolutionId) ?? own[0];
  if (!r) return null;
  const away = r.excluded.filter((e) => present.votingContactIds.includes(e.contactId)).length;
  return { itemNumber: item.position, present: present.voting - away };
}

/** Gemeinsam oder einzeln steht fest, sobald am TOP ein Entlastungsbeschluss besteht (Review Focus 5). */
export function dischargeModeLocked(resolutions: readonly AnyResolution[], itemId: string): boolean {
  return dischargesOf(resolutions, itemId).length > 0;
}
