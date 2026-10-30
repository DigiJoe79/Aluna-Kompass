'use client';

import type { AgendaItemView, AttendanceView, ElectionView, MeetingContext, MeetingDetail, ResolutionView } from '@kompass/module-governance';
import { presentFromRows, quorumPresent, type ResolutionKind } from '@kompass/module-governance/live';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { AgendaJumpList, type AgendaJumpEntry } from '@/components/governance/agenda-jump-list';
import { QuorumStrip } from '@/components/governance/quorum-strip';
import type { VoteTallyValue } from '@/components/governance/vote-tally';
import { KeyChip } from '@/components/key-chip';
import { Notice } from '@/components/notice';
import { statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { ActionState } from '@/lib/actions';
import { liveClock, liveTimeOn } from '@/lib/governance/clock';
import { liveEntries, recountAfterDeparture, scopeOf, tallyValueOf } from '@/lib/governance/live-model';
import { ruleSource } from '@/lib/governance/majority-text';
import { liveShortcut } from '@/lib/governance/shortcuts';
import { computeTally, quorumKnife, selfCountByDefault } from '@/lib/governance/tally';
import { useLiveQueue } from '@/lib/governance/use-live-queue';
import { acceptElectionAction, addAttendeeAction, addItemAction, admitLateMotionAction, arriveAction, decideAction, leaveAction, recordDischargeResultAction, recordResultAction, saveElectionRoundAction, saveFindingsAction, setNoteAction, takeOverAction } from './actions';
import { DischargeBlock, type DischargeTarget } from './discharge-block';
import { ElectionBlock, type ElectionSend } from './election-block';
import { FloorMotionDialog } from './floor-motion-dialog';
import { LateMotionBlock } from './late-motion-block';
import { MandateFields, mandateDetails, type MandateDraft } from './mandate-fields';
import { isPersonKind, PersonFields, personDetails, personDraft, type PersonDraft } from './person-fields';
import { ResolutionDetailsFields, type DetailsOptions } from '../../../resolution-details-fields';
import { detailsDraft, detailsPayload, isDetailsKind, type DetailsDraft, type DetailsKind } from '@/lib/governance/resolution-details';
import { AddItemDialog } from './add-item-dialog';
import { AttendancePanel } from './attendance-panel';
import { EndDialog } from './end-dialog';
import { FindingsCard, findingsComplete, type FindingsDraft } from './findings-card';
import { MeetingWarnings } from '../meeting-warnings';
import { ItemPanel } from './item-panel';
import { ResolutionBlock } from './resolution-block';

/** Die Aktionen, die die Warteschlange sendet — mit Namen, damit Unversandtes nach einem Neuladen wieder hinausgeht. */
const ACTIONS = {
  recordResult: recordResultAction,
  decide: decideAction,
  arrive: arriveAction,
  leave: leaveAction,
  addAttendee: addAttendeeAction,
  findings: saveFindingsAction,
  note: setNoteAction,
  addItem: addItemAction,
  electionRound: saveElectionRoundAction,
  acceptElection: acceptElectionAction,
  dischargeResult: recordDischargeResultAction,
  admitLateMotion: admitLateMotionAction,
} as const;
export type LiveActionName = keyof typeof ACTIONS;
type Payload = { name: LiveActionName; args: unknown[]; scope: string };

const NON_RESOLUTION = ['report', 'discussion', 'other'];
const isResolutionItem = (item: AgendaItemView) => !NON_RESOLUTION.includes(item.kind);
const openPeriod = (row: AttendanceView) => (row.periods.at(-1)?.to === null ? row.periods.at(-1)! : null);

export interface LiveWorkspaceProps {
  meeting: MeetingDetail;
  context: MeetingContext;
  title: string;
  today: string;
  canRecord: boolean;
  canPickContacts: boolean;
  /** Auswahlen der Angaben strukturierter Beschlussarten (Plan U2 Task 12). */
  detailsOptions: DetailsOptions;
}

/**
 * Die Arbeitsfläche Mitlauf (N1, Board Gremien 1a–1i): Lageleiste, Sprungliste und der aktuelle Punkt. Jede Eingabe geht
 * ohne Knopf in die Warteschlange (der Reihe nach, hält ohne Netz); nach dem Speichern lädt die Seite den Stand des
 * Servers. Wer nicht schreibt, sieht lesend und erneuert alle 15 s.
 */
export function LiveWorkspace({ meeting: m, context: c, title, canRecord, canPickContacts, detailsOptions }: LiveWorkspaceProps) {
  const t = useTranslations('governance');
  const tl = useTranslations('governance.live');
  const tm = useTranslations('governance.majority');
  const { time, timeZone } = useDateFormat();
  const router = useRouter();
  const readOnly = !canRecord || !c.writer.isCaller;
  const now = useCallback(() => liveTimeOn(liveClock.nowIso(), m.heldOn, timeZone, (iso) => time(iso)), [time, timeZone, m.heldOn]);

  // Nach dem Speichern den Stand des Servers laden — entprellt, damit eine Serie von Eingaben einmal lädt.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 300);
  }, [router]);
  const { enqueue, state: saveState, pending, restored } = useLiveQueue(m.id, refresh);
  const [refusals, setRefusals] = useState<Record<string, ActionState>>({});

  const send = useCallback(
    (key: string, payload: Payload) => {
      enqueue({
        key,
        payload,
        action: () => (ACTIONS[payload.name] as (...args: unknown[]) => Promise<ActionState>)(...payload.args),
        onRefused: (state) => setRefusals((r) => ({ ...r, [payload.scope]: state })),
        onDone: (state) => {
          if (state.status === 'success') setRefusals((r) => (payload.scope in r ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== payload.scope)) : r));
        },
      });
    },
    [enqueue],
  );

  // Was ein früherer Besuch nicht mehr senden konnte, geht wieder hinaus (Entscheidung 2).
  const replayed = useRef(false);
  useEffect(() => {
    if (replayed.current || readOnly || restored.length === 0) return;
    replayed.current = true;
    for (const op of restored) {
      const payload = op.payload as Payload | undefined;
      if (payload && payload.name in ACTIONS) send(op.key, payload);
    }
  }, [restored, readOnly, send]);

  // Wer liest, sieht den Stand alle 15 s neu (Route-Refresh, keine Server Action als Abfrage).
  useEffect(() => {
    if (!readOnly) return;
    const timer = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(timer);
  }, [readOnly, router]);

  // Anwesenheit: eigene Eingaben sofort sichtbar, bis der Stand des Servers sie trägt.
  const [overrides, setOverrides] = useState<Record<string, AttendanceView['periods']>>({});
  useEffect(() => setOverrides({}), [m.attendance]);
  const attendance = useMemo(() => m.attendance.map((a) => (overrides[a.id] ? { ...a, periods: overrides[a.id]! } : a)), [m.attendance, overrides]);
  const present = presentFromRows(attendance, now());
  const quorumCount = quorumPresent(present, c.rules.quorum.basis, c.rules.assembly);

  // Ergebnis-Karten: der Stand im Browser, sonst der gespeicherte Beschluss.
  const [tallies, setTallies] = useState<Record<string, VoteTallyValue>>({});
  const votedAt = useRef<Record<string, string>>({});
  const resolutionOf = (itemId: string) => m.resolutions.find((r) => r.agendaItemId === itemId && r.kind !== 'election' && r.kind !== 'discharge') as ResolutionView | undefined;
  const valueOf = (key: string, r: ResolutionView | null | undefined) => tallies[key] ?? tallyValueOf(r ?? null);

  const pendingReasons = useMemo(() => {
    const keys = new Set<string>();
    for (const [key, v] of Object.entries(tallies)) if ((v.outcome === 'adopted' || v.outcome === 'rejected') && !v.reason.trim()) keys.add(key);
    return keys;
  }, [tallies]);
  // Nur Abweichungen zählen als „Begründung fehlt“; das prüft die Rechnung je Punkt unten (`againstFor`).
  const entries = liveEntries(m.agenda, m.resolutions, m.motions, c.names, new Set([...pendingReasons].filter((k) => againstFor(k))));
  const [current, setCurrent] = useState(entries[0]?.key ?? '');
  const currentIndex = Math.max(0, entries.findIndex((e) => e.key === current));
  const entry = entries[currentIndex];
  const item = m.agenda.find((i) => i.id === entry?.key) ?? null;

  const weiter = useRef<HTMLButtonElement>(null);
  const focusWeiter = () => setTimeout(() => weiter.current?.focus(), 0);
  const go = (index: number) => {
    const target = entries[Math.min(Math.max(index, 0), entries.length - 1)];
    if (target) setCurrent(target.key);
  };

  /** Die Rechnung eines Punkts: wer abstimmt, wer ausgeschlossen ist. */
  function countsFor(r: ResolutionView | null | undefined) {
    const excluded = (r?.excluded ?? []).filter((e) => present.votingContactIds.includes(e.contactId)).length;
    return { presentVoting: present.voting, excluded, voters: present.voting - excluded };
  }
  function againstFor(key: string): boolean {
    const v = tallies[key];
    const target = m.agenda.find((i) => i.id === key);
    if (!v || !target || v.mode !== 'counting') return false;
    const majority = c.rules.majorities[target.id];
    if (!majority) return false;
    const r = resolutionOf(target.id);
    const counts = countsFor(r);
    const self = v.yes !== null || selfCountByDefault(target.kind as ResolutionKind);
    const tally = computeTally({ kind: target.kind as ResolutionKind, ...counts, allVoting: c.rules.allVoting, majority: majority.value, tie: c.rules.tie, no: v.no, abstain: v.abstain, invalid: v.invalid, yes: self ? (v.yes ?? 0) : null });
    return tally.suggested !== null && (v.outcome === 'adopted' || v.outcome === 'rejected') && v.outcome !== tally.suggested;
  }

  // Aufträge: Empfänger, Fälligkeit, Aufgabe (vorbelegt aus dem gespeicherten Beschluss).
  const [mandates, setMandates] = useState<Record<string, MandateDraft>>({});
  const mandateOf = (itemId: string): MandateDraft => {
    if (mandates[itemId]) return mandates[itemId]!;
    const d = resolutionOf(itemId)?.details as { organId?: string | null; officeId?: string | null; dueOn?: string; task?: string } | null | undefined;
    return { recipient: d?.organId ? `organ:${d.organId}` : d?.officeId ? `office:${d.officeId}` : '', dueOn: d?.dueOn ?? '', task: d?.task ?? '' };
  };

  // Wen Abberufung und Ehrenmitglied betreffen (G-3), vorbelegt aus dem gespeicherten Beschluss.
  const [persons, setPersons] = useState<Record<string, PersonDraft>>({});
  const personOf = (itemId: string): PersonDraft => persons[itemId] ?? personDraft(resolutionOf(itemId)?.details ?? null);

  // Angaben der strukturierten Arten (Plan U2 Task 12): Vergütung, Aufwendungsersatz, Rücklage, Ausschluss.
  const [detailDrafts, setDetailDrafts] = useState<Record<string, DetailsDraft[DetailsKind]>>({});
  const detailsOf = (item: AgendaItemView): DetailsDraft[DetailsKind] => detailDrafts[item.id] ?? detailsDraft(item.kind as DetailsKind, resolutionOf(item.id)?.details ?? null);

  /** Eine Änderung der Ergebnis-Karte geht als eine Sendung hinaus: Stimmen und Feststellung. */
  function sendResult(target: AgendaItemView, next: VoteTallyValue, at: string, mandate?: MandateDraft, structured?: DetailsDraft[DetailsKind], person?: PersonDraft) {
    const r = resolutionOf(target.id);
    const majority = c.rules.majorities[target.id];
    const details = target.kind === 'mandate' ? mandateDetails(mandate ?? mandateOf(target.id)) : isPersonKind(target.kind) ? personDetails(target.kind, person ?? personOf(target.id)) : isDetailsKind(target.kind) ? detailsPayload(target.kind, structured ?? detailsOf(target)) : null;
    const base = { meetingId: m.id, agendaItemId: target.id, ...(r ? { resolutionId: r.id } : {}), text: target.proposal?.trim() || target.title, votedAt: at, ...(details ? { details } : {}) };
    let input: Parameters<typeof recordResultAction>[0];
    if (next.outcome === 'postponed' || next.outcome === 'withdrawn') input = { ...base, outcome: next.outcome };
    else if (next.mode === 'unanimous') input = { ...base, unanimous: true, outcome: 'adopted' };
    else if (next.mode === 'counting' && majority) {
      if (next.no + next.abstain + next.invalid === 0 && next.yes === null && next.outcome === null) return;
      const counts = countsFor(r);
      const self = next.yes !== null || selfCountByDefault(target.kind as ResolutionKind);
      const yes = self ? (next.yes ?? 0) : null;
      const tally = computeTally({ kind: target.kind as ResolutionKind, ...counts, allVoting: c.rules.allVoting, majority: majority.value, tie: c.rules.tie, no: next.no, abstain: next.abstain, invalid: next.invalid, yes });
      if (!tally.valid) return;
      const outcome = next.outcome === 'adopted' || next.outcome === 'rejected' ? next.outcome : tally.suggested;
      input = { ...base, votes: { no: next.no, abstain: next.abstain, invalid: next.invalid, ...(yes === null ? {} : { yes }) }, yesComputed: yes === null, outcome, outcomeReason: next.reason.trim() || null };
    } else return;
    send(`result:${target.id}`, { name: 'recordResult', args: [input], scope: target.id });
  }

  function changeTally(target: AgendaItemView, next: VoteTallyValue) {
    setTallies((all) => ({ ...all, [target.id]: next }));
    const r = resolutionOf(target.id);
    const at = (votedAt.current[target.id] ??= r?.votedAt ?? now());
    sendResult(target, next, at);
    if (next.mode === 'unanimous' || next.outcome === 'postponed' || next.outcome === 'withdrawn') focusWeiter();
  }

  /** Entlastung: jede Änderung einer Karte als eine Sendung (legt beim ersten Mal die Beschlüsse an). */
  function changeDischarge(target: AgendaItemView, d: DischargeTarget, mode: 'individual' | 'collective', all: string[], next: VoteTallyValue) {
    setTallies((v) => ({ ...v, [d.key]: next }));
    const at = (votedAt.current[d.key] ??= d.resolution?.votedAt ?? now());
    const closed = next.outcome === 'postponed' || next.outcome === 'withdrawn';
    let votes: { no: number; abstain: number; invalid: number; yes?: number } | undefined;
    let outcome: VoteTallyValue['outcome'] = next.outcome;
    if (!closed && next.mode === 'counting') {
      if (next.no + next.abstain + next.invalid === 0 && next.yes === null && next.outcome === null) return;
      const majority = c.rules.majorities[target.id];
      if (!majority) return;
      const away = d.contactIds.filter((id) => present.votingContactIds.includes(id)).length;
      const tally = computeTally({ kind: 'discharge', voters: present.voting - away, presentVoting: present.voting, excluded: away, allVoting: c.rules.allVoting, majority: majority.value, tie: c.rules.tie, no: next.no, abstain: next.abstain, invalid: next.invalid, yes: next.yes });
      if (!tally.valid) return;
      votes = { no: next.no, abstain: next.abstain, invalid: next.invalid, ...(next.yes === null ? {} : { yes: next.yes }) };
      outcome = next.outcome === 'adopted' || next.outcome === 'rejected' ? next.outcome : tally.suggested;
    } else if (!closed && next.mode !== 'unanimous') return;
    const input = { meetingId: m.id, agendaItemId: target.id, fiscalYearId: target.fiscalYearId ?? '', mode, contactIds: all, target: d.target, text: target.proposal?.trim() || target.title, votedAt: at, ...(next.mode === 'unanimous' && !closed ? { unanimous: true, outcome: 'adopted' as const } : { ...(votes ? { votes, yesComputed: next.yes === null } : {}), outcome, outcomeReason: next.reason.trim() || null }) };
    send(`result:${d.key}`, { name: 'dischargeResult', args: [input], scope: target.id });
    if (next.mode === 'unanimous' || closed) focusWeiter();
  }

  /** Aufnahme eines späten Antrags: Art und Ergebnis als eine Sendung. */
  const [motionKinds, setMotionKinds] = useState<Record<string, string>>({});
  function changeAdmission(motionId: string, kind: string, next: VoteTallyValue) {
    const key = `motion:${motionId}`;
    setTallies((v) => ({ ...v, [key]: next }));
    const at = (votedAt.current[key] ??= now());
    const closed = next.outcome === 'postponed' || next.outcome === 'withdrawn';
    let votes: { no: number; abstain: number; invalid: number; yes?: number } | undefined;
    let outcome: VoteTallyValue['outcome'] = next.outcome;
    if (!closed && next.mode === 'counting') {
      if (next.no + next.abstain + next.invalid === 0 && next.yes === null && next.outcome === null) return;
      const tally = computeTally({ kind: 'agenda', voters: present.voting, presentVoting: present.voting, excluded: 0, allVoting: c.rules.allVoting, majority: c.rules.lateMotion.value, tie: c.rules.tie, no: next.no, abstain: next.abstain, invalid: next.invalid, yes: next.yes });
      if (!tally.valid) return;
      votes = { no: next.no, abstain: next.abstain, invalid: next.invalid, ...(next.yes === null ? {} : { yes: next.yes }) };
      outcome = next.outcome === 'adopted' || next.outcome === 'rejected' ? next.outcome : tally.suggested;
    } else if (!closed && next.mode !== 'unanimous') return;
    const input = { motionId, votedAt: at, kind, ...(next.mode === 'unanimous' && !closed ? { unanimous: true, outcome: 'adopted' as const } : { ...(votes ? { votes, yesComputed: next.yes === null } : {}), outcome, outcomeReason: next.reason.trim() || null }) };
    send(`admit:${motionId}`, { name: 'admitLateMotion', args: [m.id, input], scope: key });
    if (next.mode === 'unanimous' || closed) focusWeiter();
  }

  /** Wahl: ein Wahlgang oder die Annahme. */
  const acceptRef = useRef<(() => void) | null>(null);
  const registerAccept = useCallback((fn: (() => void) | null) => {
    acceptRef.current = fn;
  }, []);
  const sendElection = useCallback(
    (target: string, payload: ElectionSend) => {
      if (payload.kind === 'round') send(`election:${target}:${payload.officeId}:${payload.round.number}`, { name: 'electionRound', args: [m.id, { agendaItemId: target, officeId: payload.officeId, votedAt: payload.votedAt, round: payload.round }], scope: target });
      else send(`accept:${payload.resolutionId}:${payload.contactId}`, { name: 'acceptElection', args: [m.id, { resolutionId: payload.resolutionId, contactId: payload.contactId, ...(payload.declined ? { declined: true } : {}) }], scope: target });
    },
    [send, m.id],
  );

  // Kommen und Gehen. Geht jemand während einer Zählung mit errechnetem Ja, rechnet Kompass neu (Abnahme 8).
  const arrive = (row: AttendanceView, at: string) => {
    setOverrides((o) => ({ ...o, [row.id]: [...row.periods, { from: at, to: null }] }));
    send(`arrive:${row.id}:${at}:${row.periods.length}`, { name: 'arrive', args: [m.id, row.id, at], scope: 'attendance' });
  };
  const leave = (row: AttendanceView, at: string) => {
    const open = openPeriod(row);
    if (!open) return;
    setOverrides((o) => ({ ...o, [row.id]: [...row.periods.slice(0, -1), { from: open.from, to: at }] }));
    send(`leave:${row.id}:${at}`, { name: 'leave', args: [m.id, row.id, at], scope: 'attendance' });
    if (!item || !isResolutionItem(item)) return;
    const value = valueOf(item.id, resolutionOf(item.id));
    if (!recountAfterDeparture(value) || value.no + value.abstain + value.invalid === 0) return;
    const name = row.contactId ? (c.names[row.contactId] ?? '') : (row.guestLabel ?? '');
    const next = { ...value, recountNote: tl('recount', { name }) };
    setTallies((all) => ({ ...all, [item.id]: next }));
    votedAt.current[item.id] = at;
    // Nach dem Gehen gezählt: die Sendung des Gehens steht vorn in der Schlange.
    sendResult(item, next, at);
  };

  // Feststellungen zu Beginn: vorbelegt aus dem Vorschlag und der geplanten Besetzung.
  const f = m.findings!;
  const [findings, setFindings] = useState<FindingsDraft>(() => ({
    chairContactId: f?.chairContactId ?? m.plannedChairContactId,
    minuteTakerContactId: f?.minuteTakerContactId ?? m.plannedMinuteTakerContactId,
    chairBy: f?.chairBy ?? null,
    invitationProper: f?.invitationProper ?? f?.suggested.invitationProper ?? null,
    invitationNote: f?.invitationNote ?? '',
    quorate: f?.quorate ?? f?.suggested.quorum.met ?? null,
    quorumNote: f?.quorumNote ?? '',
    agendaApproved: f?.agendaApproved ?? null,
  }));
  const changeFindings = (next: FindingsDraft) => {
    setFindings(next);
    if (!f || !findingsComplete(next, f.suggested)) return;
    send('findings', { name: 'findings', args: [m.id, { ...next, invitationNote: next.invitationNote.trim() || null, quorumNote: next.quorumNote.trim() || null }], scope: 'findings' });
  };

  const [sheet, setSheet] = useState(false);
  const [floor, setFloor] = useState(false);
  // Ein aufgenommener Antrag wird zum TOP: die Sprungliste springt dorthin.
  useEffect(() => {
    if (!current.startsWith('motion:') || entries.some((e) => e.key === current)) return;
    const admitted = m.agenda.find((i) => i.motionId === current.slice('motion:'.length));
    if (admitted) setCurrent(admitted.id);
  }, [current, entries, m.agenda]);
  const [ending, setEnding] = useState(false);
  const [adding, setAdding] = useState(false);
  const takeOver = useActionFeedback();

  // Tastenkürzel (N5): nur schreibend, nie in einem Textfeld.
  const keyState = useRef({ item, entry, currentIndex });
  keyState.current = { item, entry, currentIndex };
  useEffect(() => {
    if (readOnly) return;
    const onKey = (event: KeyboardEvent) => {
      const shortcut = liveShortcut(event);
      if (!shortcut) return;
      const { item: it, currentIndex: index } = keyState.current;
      if (shortcut === 'prev' || shortcut === 'next') {
        event.preventDefault();
        go(index + (shortcut === 'next' ? 1 : -1));
        return;
      }
      if (shortcut === 'attendance') {
        event.preventDefault();
        setSheet(true);
        return;
      }
      if (shortcut === 'accept') {
        if (acceptRef.current) {
          event.preventDefault();
          acceptRef.current();
        }
        return;
      }
      const motionKey = keyState.current.entry?.key;
      if (!it && motionKey?.startsWith('motion:') && (shortcut === 'unanimous' || shortcut === 'count')) {
        const motionId = motionKey.slice('motion:'.length);
        const adm = m.resolutions.find((x) => x.kind === 'agenda' && (x.details as { motionId?: string } | null)?.motionId === motionId) as ResolutionView | undefined;
        const value = tallies[motionKey] ?? tallyValueOf(adm ?? null);
        if (value.mode !== 'idle') return;
        event.preventDefault();
        const kind = motionKinds[motionId] ?? (adm?.details as { kind?: string } | null)?.kind ?? 'simple';
        if (shortcut === 'unanimous') changeAdmission(motionId, kind, { ...value, mode: 'unanimous', outcome: 'adopted' });
        else setTallies((all) => ({ ...all, [motionKey]: { ...value, mode: 'counting' } }));
        return;
      }
      if (!it || !isResolutionItem(it) || it.kind === 'election' || it.kind === 'discharge' || !c.rules.majorities[it.id]) return;
      const value = valueOf(it.id, resolutionOf(it.id));
      if (value.mode !== 'idle') return;
      event.preventDefault();
      if (shortcut === 'unanimous') changeTally(it, { ...value, mode: 'unanimous', outcome: 'adopted' });
      if (shortcut === 'count') setTallies((all) => ({ ...all, [it.id]: { ...value, mode: 'counting' } }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openPoints = m.resolutions.filter((r) => r.kind !== 'election' && r.outcome === null).length + pendingReasons.size;
  const jump: AgendaJumpEntry[] = entries.map((e) => ({
    key: e.key,
    number: e.number,
    title: e.title,
    summary: e.summary ? tl(`summary.${e.summary.key}`, { name: e.summary.name ?? '' }) : null,
    done: e.done,
    mark: e.mark === 'reasonMissing' ? { tone: 'warning', label: tl('marks.reasonMissing') } : e.mark === 'againstCount' ? { tone: statusTone('resolution', 'overridden'), label: tl('marks.againstCount') } : null,
  }));
  const next = entries[currentIndex + 1];
  const prev = entries[currentIndex - 1];
  const first = item?.position === 1;
  const attendancePanel = (
    <AttendancePanel
      rows={attendance}
      names={c.names}
      now={now}
      readOnly={readOnly}
      founding={m.kind === 'founding'}
      canPickContacts={canPickContacts}
      total={c.rules.allVoting}
      heldOn={m.heldOn}
      onArrive={arrive}
      onLeave={leave}
      onAdd={(input) => send(`add:${input.role}:${input.guestLabel ?? input.contactId}`, { name: 'addAttendee', args: [{ meetingId: m.id, ...input, at: now() }], scope: 'attendance' })}
    />
  );
  const r = item ? resolutionOf(item.id) : undefined;
  const majority = item ? c.rules.majorities[item.id] : null;
  const people = attendance.filter((a) => !a.guest && a.contactId && openPeriod(a)).map((a) => ({ id: a.contactId!, name: c.names[a.contactId!] ?? '' }));
  // Entlastung: die Leiste zählt für den Punkt ohne die anwesenden Betroffenen (Abnahme 7).
  const plannedDischarge = item?.kind === 'discharge' && !m.resolutions.some((x) => x.agendaItemId === item.id && x.kind === 'discharge') ? (c.discharge[item.id] ?? []) : null;
  const scoped = item ? (plannedDischarge ? { itemNumber: item.position, present: present.voting - plannedDischarge.filter((id) => present.votingContactIds.includes(id)).length } : scopeOf(item, m.resolutions, present, null)) : null;
  const stripScope = scoped ? { label: tl('scope', { n: scoped.itemNumber }), present: scoped.present } : null;
  const motion = entry?.key.startsWith('motion:') ? m.motions.find((x) => `motion:${x.id}` === entry.key) : undefined;
  const admission = motion ? (m.resolutions.find((x) => x.kind === 'agenda' && (x.details as { motionId?: string } | null)?.motionId === motion.id) as ResolutionView | undefined) : undefined;

  return (
    <div className="flex flex-col gap-4" data-testid="live-workspace">
      <QuorumStrip
        title={title}
        voting={present.voting}
        guests={attendance.filter((a) => a.guest && openPeriod(a)).length}
        scope={stripScope}
        quorum={{ required: c.rules.quorum.required, met: c.rules.quorum.required === null ? null : quorumCount >= c.rules.quorum.required, knife: quorumKnife(c.rules.quorum.required, quorumCount) }}
        save={{ state: saveState, pending: pending > 0 }}
        onAttendance={() => setSheet(true)}
        onEnd={readOnly ? null : () => setEnding(true)}
      />
      {readOnly ? (
        <Notice level="hint">
          <span className="flex flex-col gap-2">
            {tl('writer.other')}
            {canRecord ? (
              <span>
                <Button type="button" variant="outline" size="sm" onClick={async () => { const res = await takeOver.run(() => takeOverAction(m.id)); if (res.status === 'success') router.refresh(); }} data-testid="live-take-over">{tl('writer.takeOver')}</Button>
              </span>
            ) : null}
            <RefusalNotice action state={takeOver.state} />
          </span>
        </Notice>
      ) : null}
      {refusals.attendance ? <RefusalNotice state={refusals.attendance} /> : null}
      {entries.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-ink-2">{tl('empty.text')}</p>
          {readOnly ? null : <Button type="button" variant="outline" onClick={() => setAdding(true)} data-testid="live-add-item">{tl('empty.create')}</Button>}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <AgendaJumpList entries={jump} current={entry?.key ?? ''} onSelect={setCurrent} label={tl('jump.label')} footer={readOnly ? null : <Button type="button" variant="outline" size="sm" onClick={() => setFloor(true)} data-testid="live-floor-motion">{tl('floor.open')}</Button>} />
          <div className="flex max-w-[820px] min-w-0 flex-col gap-6">
            {first ? (
              <>
                {/* G-25: die Hinweise an der Sitzung; „gegen den Vorschlag“ sagt die Karte selbst. */}
                <MeetingWarnings warnings={[...m.warnings, ...(m.findings?.warnings ?? []).filter((w) => w === 'minuteTakerAbsent')]} />
                {attendancePanel}
                <FindingsCard draft={findings} suggested={f.suggested} attendance={attendance} names={c.names} readOnly={readOnly} onChange={changeFindings} />
                {refusals.findings ? <RefusalNotice state={refusals.findings} /> : null}
              </>
            ) : null}
            {item ? (
              <ItemPanel
                key={item.id}
                item={item}
                kindLabel={t(`agendaKinds.${item.kind}`)}
                strictSource={majority ? ruleSource(tm, majority) : ''}
                readOnly={readOnly}
                onNote={(note) => send(`note:${item.id}`, { name: 'note', args: [m.id, item.id, note], scope: item.id })}
              >
                {r?.warnings.filter((w) => w === 'statuteRegistered' || w === 'statuteNotAssembly' || w === 'remunerationWithoutStatute' || w === 'remunerationWrongOrgan' || w === 'expenseRuleRetroactive' || w === 'exclusionChecklistOpen' || w === 'detailsMissing').map((w) => <Notice key={w} level="warn">{tl(`detailWarnings.${w}`)}</Notice>)}
                {item.kind === 'mandate' ? (
                  <MandateFields
                    id={item.id}
                    context={c}
                    draft={mandateOf(item.id)}
                    readOnly={readOnly}
                    onChange={(draft) => {
                      setMandates((all) => ({ ...all, [item.id]: draft }));
                      const value = valueOf(item.id, r);
                      if (value.mode !== 'idle' || value.outcome) sendResult(item, value, (votedAt.current[item.id] ??= r?.votedAt ?? now()), draft);
                    }}
                  />
                ) : null}
                {isPersonKind(item.kind) ? (
                  <PersonFields
                    id={item.id}
                    kind={item.kind}
                    context={c}
                    options={detailsOptions}
                    draft={personOf(item.id)}
                    readOnly={readOnly}
                    onChange={(draft) => {
                      setPersons((all) => ({ ...all, [item.id]: draft }));
                      const value = valueOf(item.id, r);
                      if (value.mode !== 'idle' || value.outcome) sendResult(item, value, (votedAt.current[item.id] ??= r?.votedAt ?? now()), undefined, undefined, draft);
                    }}
                  />
                ) : null}
                {isDetailsKind(item.kind) ? (
                  <ResolutionDetailsFields
                    id={`details-${item.id}`}
                    kind={item.kind}
                    organId={c.organ.id}
                    draft={detailsOf(item)}
                    options={detailsOptions}
                    decidedOn={m.heldOn}
                    readOnly={readOnly}
                    onChange={(draft) => {
                      setDetailDrafts((all) => ({ ...all, [item.id]: draft }));
                      const value = valueOf(item.id, r);
                      if (value.mode !== 'idle' || value.outcome) sendResult(item, value, (votedAt.current[item.id] ??= r?.votedAt ?? now()), undefined, draft);
                    }}
                  />
                ) : null}
                {item.kind === 'election' ? (
                  item.officeIds.length === 0 ? (
                    <Notice level="warn">{tl('election.noOffice')}</Notice>
                  ) : (
                    item.officeIds.map((officeId) => (
                      <ElectionBlock
                        key={officeId}
                        officeId={officeId}
                        context={c}
                        election={m.resolutions.find((x) => x.kind === 'election' && x.agendaItemId === item.id && (x.details as { officeId?: string } | null)?.officeId === officeId) as ElectionView | undefined}
                        people={people}
                        voters={present.voting}
                        readOnly={readOnly}
                        canPickContacts={canPickContacts}
                        now={now}
                        refusal={refusals[item.id] ?? null}
                        onSend={(payload) => sendElection(item.id, payload)}
                        onRegisterAccept={registerAccept}
                      />
                    ))
                  )
                ) : null}
                {item.kind === 'discharge' ? (
                  <DischargeBlock
                    meetingId={m.id}
                    item={item}
                    context={c}
                    resolutions={m.resolutions as ResolutionView[]}
                    present={present}
                    people={people}
                    values={tallies}
                    readOnly={readOnly}
                    refusal={refusals[item.id] ?? null}
                    onChange={(target, mode, all, next) => changeDischarge(item, target, mode, all, next)}
                    onCommit={focusWeiter}
                  />
                ) : null}
                {isResolutionItem(item) && item.kind !== 'election' && item.kind !== 'discharge' && majority ? (
                  <ResolutionBlock
                    id={item.id}
                    kind={item.kind as ResolutionKind}
                    {...countsFor(r)}
                    allVoting={c.rules.allVoting}
                    majority={majority}
                    tie={c.rules.tie}
                    value={valueOf(item.id, r)}
                    onChange={(value) => changeTally(item, value)}
                    onCommit={focusWeiter}
                    sentences={c.sentences[item.id] ?? []}
                    time={r?.votedAt ?? votedAt.current[item.id] ?? null}
                    readOnly={readOnly}
                    refusal={refusals[item.id] ?? null}
                  />
                ) : refusals[item.id] && item.kind !== 'election' && item.kind !== 'discharge' ? (
                  <RefusalNotice state={refusals[item.id]!} />
                ) : null}
              </ItemPanel>
            ) : motion ? (
              <LateMotionBlock
                motion={motion}
                admission={admission}
                context={c}
                present={present}
                kind={motionKinds[motion.id] ?? (admission?.details as { kind?: string } | null)?.kind ?? 'simple'}
                onKind={(kind) => setMotionKinds((k) => ({ ...k, [motion.id]: kind }))}
                value={tallies[`motion:${motion.id}`]}
                onChange={(next) => changeAdmission(motion.id, motionKinds[motion.id] ?? (admission?.details as { kind?: string } | null)?.kind ?? 'simple', next)}
                onCommit={focusWeiter}
                readOnly={readOnly}
                refusal={refusals[`motion:${motion.id}`] ?? null}
              />
            ) : null}
            <div className="flex items-center justify-between gap-3 max-sm:sticky max-sm:bottom-0 max-sm:border-t max-sm:border-line max-sm:bg-surface max-sm:py-2" data-testid="live-nav">
              {prev ? (
                <Button type="button" variant="outline" onClick={() => go(currentIndex - 1)} className="max-sm:hidden">
                  <ArrowLeft className="size-4" aria-hidden />
                  {tl('nav.back', { n: prev.number })}
                </Button>
              ) : (
                <span className="max-sm:hidden" />
              )}
              <Button type="button" variant="outline" size="icon" className="sm:hidden" aria-label={tl('attendance.title')} onClick={() => setSheet(true)}>
                <KeyChip>A</KeyChip>
              </Button>
              {next ? (
                <Button ref={weiter} type="button" onClick={() => go(currentIndex + 1)} data-testid="live-next" className="max-sm:flex-1">
                  {tl('nav.next', { n: next.number })}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent size="md">
          <SheetHeader>
            <SheetTitle>{tl('attendance.title')}</SheetTitle>
          </SheetHeader>
          <div className="p-5">{attendancePanel}</div>
        </SheetContent>
      </Sheet>
      <EndDialog open={ending} onOpenChange={setEnding} meetingId={m.id} now={now()} openPoints={openPoints} pending={pending} />
      {floor ? <FloorMotionDialog meetingId={m.id} afterItemId={item?.id ?? null} people={people} context={c} onClose={() => setFloor(false)} onRecorded={(id) => setCurrent(`motion:${id}`)} /> : null}
      {adding ? <AddItemDialog onClose={() => setAdding(false)} onAdd={(input) => send(`additem:${input.title}`, { name: 'addItem', args: [{ meetingId: m.id, ...input }], scope: 'items' })} /> : null}
      {refusals.items ? <RefusalNotice state={refusals.items} /> : null}
    </div>
  );
}
