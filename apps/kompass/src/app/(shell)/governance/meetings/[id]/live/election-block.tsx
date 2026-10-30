'use client';

import type { ElectionDetails, ElectionView, MeetingContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { CountField } from '@/components/count-field';
import { useDateFormat } from '@/components/date-format-provider';
import { FormField } from '@/components/forms/form-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { KeyChip } from '@/components/key-chip';
import { Notice } from '@/components/notice';
import { SectionHeading } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { majorityText, ruleSource } from '@/lib/governance/majority-text';

type Round = ElectionDetails['rounds'][number];
export type ElectionSend = { kind: 'round'; officeId: string; round: Round; votedAt: string } | { kind: 'accept'; resolutionId: string; contactId: string; declined: boolean };

/**
 * Eine Wahl im Mitlauf (Board 1d, Plan U1 Task 10): Kopf mit Amt und Regel, Kandidaten aus der Anwesenheit (andere
 * Personen über die Kontakte), bei einer Person „Einstimmig gewählt“, sonst je Wahlgang ein Zählfeld je Kandidat
 * plus Enthaltung und ungültig. Das Ergebnis rechnet der Dienst (`ElectionView`); ohne Mehrheit „Stichwahl anlegen“,
 * danach „Nimmt … die Wahl an?“.
 */
export function ElectionBlock({
  officeId,
  context,
  election,
  people,
  voters,
  readOnly,
  canPickContacts,
  now,
  refusal,
  onSend,
  onRegisterAccept,
}: {
  officeId: string;
  context: MeetingContext;
  election: ElectionView | undefined;
  people: { id: string; name: string }[];
  voters: number;
  readOnly: boolean;
  canPickContacts: boolean;
  now: () => string;
  refusal: ActionState | null;
  onSend: (send: ElectionSend) => void;
  onRegisterAccept: (fn: (() => void) | null) => void;
}) {
  const t = useTranslations('governance.live.election');
  const tm = useTranslations('governance.majority');
  const { date } = useDateFormat();
  const office = context.offices.find((o) => o.id === officeId);
  const details = election?.details as ElectionDetails | undefined;
  const lastRound = details?.rounds.at(-1);
  const [round, setRound] = useState<Round>(() => lastRound ?? { number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: null });
  const [candidates, setCandidates] = useState<string[]>(() => (lastRound ? (lastRound.unanimousContactId ? [lastRound.unanimousContactId] : lastRound.candidates.map((c) => c.contactId)) : []));
  const [extra, setExtra] = useState<PickedContact | null>(null);
  const [absent, setAbsent] = useState<string[]>([]);
  const [extraNames, setExtraNames] = useState<Record<string, string>>({});
  const nameOf = (id: string) => context.names[id] ?? people.find((p) => p.id === id)?.name ?? extraNames[id] ?? '';
  const at = election?.votedAt ?? now();

  const serverRound = election?.rounds.find((r) => r.number === round.number);
  const winners = serverRound?.reachedBy ?? [];
  const elected = details?.elected ?? [];
  const open = (election?.rounds.at(-1)?.reachedBy ?? []).filter((id) => !elected.some((e) => e.contactId === id) && !absent.includes(id));
  const ask = open[0];

  // „J“ nimmt die Wahl der ersten offenen Person an (N5).
  useEffect(() => {
    if (readOnly || !election || !ask) {
      onRegisterAccept(null);
      return;
    }
    onRegisterAccept(() => onSend({ kind: 'accept', resolutionId: election.id, contactId: ask, declined: false }));
    return () => onRegisterAccept(null);
  }, [readOnly, election, ask, onSend, onRegisterAccept]);

  const sendRound = (next: Round) => {
    setRound(next);
    onSend({ kind: 'round', officeId, round: next, votedAt: at });
  };
  const count = (n: string) => Math.max(0, Number.parseInt(n, 10) || 0);
  const votesOf = (id: string) => round.candidates.find((c) => c.contactId === id)?.votes ?? 0;
  const setVotes = (id: string, votes: number) => sendRound({ ...round, unanimousContactId: null, candidates: candidates.map((c) => ({ contactId: c, votes: c === id ? votes : votesOf(c) })) });
  const sum = round.unanimousContactId ? voters : round.candidates.reduce((n, c) => n + c.votes, 0) + round.abstain + round.invalid + round.no;
  const officeLine = office ? [office.representative ? t('representative') : null, office.termMonths ? t('term', { months: office.termMonths }) : null, office.untilSuccessor ? t('untilSuccessor') : null].filter(Boolean).join(', ') : '';
  const rule = context.rules.election.value.rounds[Math.min(round.number - 1, context.rules.election.value.rounds.length - 1)];

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4" data-testid={`election-${officeId}`}>
      <div className="flex flex-col gap-1">
        <SectionHeading>{t('head', { office: office?.name ?? '' })}</SectionHeading>
        {officeLine ? <p className="text-meta text-ink-2">{officeLine}</p> : null}
        {rule ? <p className="text-meta text-ink-2">{t('rule', { majority: majorityText(tm, rule), source: ruleSource(tm, context.rules.election) })}</p> : null}
      </div>
      {refusal ? <RefusalNotice state={refusal} /> : null}
      {election?.warnings.filter((w) => w === 'incompatible' || w === 'seatsExceeded').map((w) => <Notice key={w} level="warn">{t(`warnings.${w}`)}</Notice>)}
      {!readOnly && elected.length === 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <FormField id={`candidate-${officeId}`} label={t('addCandidate')}>
            <Select id={`candidate-${officeId}`} value="" onChange={(e) => e.target.value && setCandidates((c) => [...c, e.target.value])}>
              <option value="">{t('choose')}</option>
              {people.filter((p) => !candidates.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </FormField>
          {canPickContacts ? (
            <div className="min-w-60">
              <ContactPicker id={`candidate-other-${officeId}`} name="candidate" label={t('other')} value={extra} kind="person" onChange={(c) => { setExtra(null); if (c && !candidates.includes(c.id)) { setExtraNames((n) => ({ ...n, [c.id]: c.name })); setCandidates((list) => [...list, c.id]); } }} />
            </div>
          ) : null}
        </div>
      ) : null}
      {candidates.length > 0 && elected.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-meta text-muted-ink">{round.runoff ? t('runoffRound') : t('round', { n: round.number })}</p>
          {candidates.length === 1 && !readOnly ? (
            <div>
              <Button type="button" onClick={() => sendRound({ ...round, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: candidates[0]! })} data-testid={`election-unanimous-${officeId}`}>
                {t('unanimous')}
              </Button>
            </div>
          ) : null}
          {readOnly ? (
            <p className="text-body text-ink-2">{candidates.map((c) => `${nameOf(c)}: ${round.unanimousContactId === c ? voters : votesOf(c)}`).join(' · ')}</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {candidates.map((c) => (
                <FormField key={c} id={`votes-${officeId}-${c}`} label={t('votesFor', { name: nameOf(c) })} size="s">
                  <CountField id={`votes-${officeId}-${c}`} value={round.unanimousContactId === c ? voters : votesOf(c)} onChange={(e) => setVotes(c, count(e.target.value))} min={0} />
                </FormField>
              ))}
              <FormField id={`votes-${officeId}-abstain`} label={t('abstain')} size="s">
                <CountField id={`votes-${officeId}-abstain`} value={round.abstain} onChange={(e) => sendRound({ ...round, unanimousContactId: null, candidates: candidates.map((c) => ({ contactId: c, votes: votesOf(c) })), abstain: count(e.target.value) })} min={0} />
              </FormField>
              <FormField id={`votes-${officeId}-invalid`} label={t('invalid')} size="s">
                <CountField id={`votes-${officeId}-invalid`} value={round.invalid} onChange={(e) => sendRound({ ...round, unanimousContactId: null, candidates: candidates.map((c) => ({ contactId: c, votes: votesOf(c) })), invalid: count(e.target.value) })} min={0} />
              </FormField>
            </div>
          )}
          <p className="text-meta text-ink-2">{t('sum', { sum, voters })}</p>
          {serverRound ? (
            winners.length > 0 ? (
              <p className="text-meta text-success">{t('reached', { names: winners.map(nameOf).join(', '), needed: serverRound.needed })}</p>
            ) : (
              <p className="text-meta text-warning">{t('notReached', { needed: serverRound.needed })}</p>
            )
          ) : null}
          {!readOnly && election?.runoffSuggested ? (
            <div>
              <Button type="button" variant="outline" onClick={() => { setCandidates([...election.runoffSuggested!.contactIds]); setRound({ number: round.number + 1, runoff: true, candidates: election.runoffSuggested!.contactIds.map((contactId) => ({ contactId, votes: 0 })), no: 0, abstain: 0, invalid: 0, unanimousContactId: null }); }}>
                {t('runoff')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {elected.map((e) => (
        <p key={e.contactId} className="text-meta text-ink-2">
          {e.declinedOn ? t('declined', { name: nameOf(e.contactId) }) : e.acceptedOn ? t('accepted', { name: nameOf(e.contactId), date: date(e.acceptedOn) }) : null}
        </p>
      ))}
      {absent.map((id) => <p key={id} className="text-meta text-ink-2">{t('pending', { name: nameOf(id) })}</p>)}
      {ask && election && !readOnly ? (
        <div className="flex flex-col gap-2">
          <p className="text-body text-ink">{t('acceptQuestion', { name: nameOf(ask) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onSend({ kind: 'accept', resolutionId: election.id, contactId: ask, declined: false })} data-testid={`election-accept-${officeId}`}>
              {t('accept')}
              <KeyChip label={t('keyAccept')}>J</KeyChip>
            </Button>
            <Button type="button" variant="outline" onClick={() => { onSend({ kind: 'accept', resolutionId: election.id, contactId: ask, declined: true }); setCandidates((c) => c.filter((x) => x !== ask)); }}>{t('decline')}</Button>
            <Button type="button" variant="outline" onClick={() => setAbsent((a) => [...a, ask])}>{t('absent')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
