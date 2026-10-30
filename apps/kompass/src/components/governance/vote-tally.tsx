'use client';

import type { ResolvedRule } from '@kompass/module-governance';
import type { Majority, ResolutionKind } from '@kompass/module-governance/live';
import { AlertTriangle, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type Ref } from 'react';
import { CountField } from '@/components/count-field';
import { FormField } from '@/components/forms/form-field';
import { KeyChip } from '@/components/key-chip';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { RowMenu } from '@/components/row-menu';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Textarea } from '@/components/ui/textarea';
import { majorityText, ruleSource } from '@/lib/governance/majority-text';
import { computeTally, selfCountByDefault } from '@/lib/governance/tally';

export type TallyOutcome = 'adopted' | 'rejected' | 'postponed' | 'withdrawn';

export interface VoteTallyValue {
  mode: 'idle' | 'unanimous' | 'counting';
  no: number;
  abstain: number;
  invalid: number;
  /** `null` = errechnet. */
  yes: number | null;
  outcome: TallyOutcome | null;
  reason: string;
  /** „neu errechnet, {name} ist gegangen“ (Abnahme 8). */
  recountNote: string | null;
}

const FIELDS = ['no', 'abstain', 'invalid'] as const;

/**
 * Ergebnis-Karte (N3, Freigabe Joe 2026-10-28, Board Gremien 1a–1e, 1h, 1i) für Beschluss, Wahlgang, Entlastung und
 * Dringlichkeit: „Einstimmig …“ (E) und „Auszählen“ (Z); gezählt wird wie im Saal gefragt — Nein · Enthaltung ·
 * Ungültig · Ja —, Ja errechnet steht als Wert (Subtraktionsverfahren), bei Satzung, Zweck und Auflösung als Feld.
 * Darunter Schwelle, Ergebnis (`success`/`warning`, nie `error`), „knapp“ und die Feststellung der Leitung mit
 * Begründung, wenn sie von der Zählung abweicht. Kompass sperrt nie: Kein Knopf wird gesperrt.
 */
export function VoteTally({
  id,
  kind,
  unanimousLabel,
  voters,
  presentVoting,
  allVoting,
  excluded,
  majority,
  tie,
  value,
  onChange,
  onCommit,
  sentences,
  time,
  readOnly,
  unanimousRef,
}: {
  id: string;
  kind: ResolutionKind;
  unanimousLabel: 'adopted' | 'elected' | 'discharged';
  voters: number;
  presentVoting: number;
  allVoting: number;
  excluded: number;
  majority: ResolvedRule<Majority>;
  tie: 'rejected' | 'chairDecides';
  value: VoteTallyValue;
  onChange: (next: VoteTallyValue) => void;
  onCommit: () => void;
  sentences: string[];
  time: string | null;
  readOnly: boolean;
  /** Der Knopf „Einstimmig …“ — die Seite legt den Fokus darauf, wenn der Punkt wechselt. */
  unanimousRef?: Ref<HTMLButtonElement>;
}) {
  const t = useTranslations('governance.live.tally');
  const tm = useTranslations('governance.majority');
  const noField = useRef<HTMLInputElement>(null);
  const previousMode = useRef(value.mode);
  const self = value.yes !== null || selfCountByDefault(kind);
  const tally = computeTally({ kind, voters, presentVoting, allVoting, excluded, majority: majority.value, tie, no: value.no, abstain: value.abstain, invalid: value.invalid, yes: self ? (value.yes ?? 0) : null });
  const outcome = value.outcome === 'adopted' || value.outcome === 'rejected' ? value.outcome : (tally.suggested ?? 'adopted');
  const against = value.outcome !== null && tally.suggested !== null && (value.outcome === 'adopted' || value.outcome === 'rejected') && value.outcome !== tally.suggested;

  // Abnahme 2: Wer „Auszählen“ wählt, landet in „Nein“.
  useEffect(() => {
    if (previousMode.current !== 'counting' && value.mode === 'counting' && !readOnly) noField.current?.focus();
    previousMode.current = value.mode;
  }, [value.mode, readOnly]);

  const set = (patch: Partial<VoteTallyValue>) => onChange({ ...value, ...patch });
  const number = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const enter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit();
    }
  };
  const minutes = sentences.length > 0 ? <p className="text-meta text-muted-ink" data-testid={`tally-minutes-${id}`}>{t('inMinutes', { text: sentences.join(' ') })}</p> : null;
  const closed = value.outcome === 'postponed' || value.outcome === 'withdrawn';

  if (closed) {
    return (
      <div className="flex flex-col gap-2" data-testid={`tally-${id}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body text-ink">{time ? t('closedDone', { label: t(value.outcome as 'postponed'), time }) : t(value.outcome as 'postponed')}</span>
          {readOnly ? null : <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, mode: 'idle', outcome: null })}>{t('change')}</Button>}
        </div>
        {minutes}
      </div>
    );
  }

  if (value.mode === 'unanimous') {
    return (
      <div className="flex flex-col gap-2" data-testid={`tally-${id}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-body text-success">
            <Check className="size-4" aria-hidden />
            {t('unanimousDone', { label: t(`unanimous.${unanimousLabel}`), yes: voters, time: time ?? '' })}
          </span>
          {readOnly ? null : <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, mode: 'idle', outcome: null })}>{t('change')}</Button>}
        </div>
        {minutes}
      </div>
    );
  }

  if (value.mode === 'idle') {
    if (readOnly) return <div data-testid={`tally-${id}`}>{minutes}</div>;
    return (
      <div className="flex flex-col gap-2" data-testid={`tally-${id}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Button ref={unanimousRef} type="button" onClick={() => onChange({ ...value, mode: 'unanimous', outcome: 'adopted' })} data-testid={`tally-unanimous-${id}`}>
            {t(`unanimous.${unanimousLabel}`)}
            <KeyChip label={t('keyUnanimous')}>E</KeyChip>
          </Button>
          <Button type="button" variant="outline" onClick={() => onChange({ ...value, mode: 'counting' })} data-testid={`tally-count-${id}`}>
            {t('count')}
            <KeyChip label={t('keyCount')}>Z</KeyChip>
          </Button>
          <RowMenu
            name={t('more')}
            items={[
              { key: 'postponed', label: t('postponed'), onSelect: () => onChange({ ...value, outcome: 'postponed' }) },
              { key: 'withdrawn', label: t('withdrawn'), onSelect: () => onChange({ ...value, outcome: 'withdrawn' }) },
            ]}
          />
        </div>
        {minutes}
      </div>
    );
  }

  // Auszählen.
  const result =
    !tally.valid ? (
      <p className="inline-flex items-center gap-1.5 text-meta text-warning"><AlertTriangle className="size-3.5" aria-hidden />{t('tooMany', { voters })}</p>
    ) : tally.result.reached === null ? (
      <p className="text-meta text-ink-2">{t('tieChair')}</p>
    ) : tally.result.reached ? (
      <p className="inline-flex items-center gap-1.5 text-meta text-success"><Check className="size-3.5" aria-hidden />{t('reached', { yes: tally.yes, needed: tally.result.needed })}</p>
    ) : (
      <p className="inline-flex items-center gap-1.5 text-meta text-warning"><AlertTriangle className="size-3.5" aria-hidden />{t('notReached', { yes: tally.yes, needed: tally.result.needed })}</p>
    );

  return (
    <div className="flex flex-col gap-3" data-testid={`tally-${id}`}>
      {readOnly ? (
        <p className="text-body text-ink" data-testid={`tally-values-${id}`}>{t('values', { no: value.no, abstain: value.abstain, invalid: value.invalid, yes: tally.yes })}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap">
            {FIELDS.map((field) => (
              <FormField key={field} id={`tally-${id}-${field}`} label={t(`fields.${field}`)} size="s">
                <CountField id={`tally-${id}-${field}`} ref={field === 'no' ? noField : undefined} value={value[field]} onChange={(e) => set({ [field]: number(e.target.value) })} onKeyDown={enter} min={0} />
              </FormField>
            ))}
            {self ? (
              <FormField id={`tally-${id}-yes`} label={t('fields.yes')} size="s">
                <CountField id={`tally-${id}-yes`} value={value.yes ?? ''} onChange={(e) => set({ yes: number(e.target.value) })} onKeyDown={enter} min={0} />
              </FormField>
            ) : (
              <div className="flex flex-col gap-1" data-testid={`tally-yes-${id}`}>
                <Overline as="span" field>{t('fields.yes')}</Overline>
                <span className="text-body tabular-nums text-ink">{tally.yes}</span>
                <span className="text-hint text-muted-ink">{t('computed', { voters, no: value.no, abstain: value.abstain, invalid: value.invalid })}</span>
                {value.recountNote ? <span className="text-hint text-ink-2">{value.recountNote}</span> : null}
                <span>
                  <Button type="button" variant="outline" size="sm" onClick={() => set({ yes: tally.yes })}>{t('selfCount')}</Button>
                </span>
              </div>
            )}
          </div>
          {selfCountByDefault(kind) ? <Notice level="hint">{t('selfHint')}</Notice> : null}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, mode: 'unanimous', outcome: 'adopted', no: 0, abstain: 0, invalid: 0, yes: null, reason: '' })}>{t('backUnanimous')}</Button>
          </div>
        </>
      )}
      <div className="flex flex-col gap-1 text-meta text-ink-2">
        <p>{t('required', { majority: majorityText(tm, majority.value), source: ruleSource(tm, majority) })}</p>
        <p>{t('cast', { cast: tally.cast })}</p>
        {result}
        {tally.knife ? <p data-knife className="text-meta text-warning">{t('knife')}</p> : null}
      </div>
      {readOnly ? null : (
        <div className="flex flex-col gap-2">
          <FormField id={`tally-${id}-decide`} label={t('decide')} hint={!against ? t('suggested') : undefined}>
            <Segmented
              className="self-start"
              aria-label={t('decide')}
              value={outcome}
              onValueChange={(next) => set({ outcome: next })}
              options={(['adopted', 'rejected'] as const).map((o) => ({ value: o, label: t(`outcomes.${o}`) }))}
            />
          </FormField>
          {against ? (
            <>
              <Notice level="warn">{t('against')}</Notice>
              <FormField id={`tally-${id}-reason`} label={t('reason')} required size="full">
                <Textarea id={`tally-${id}-reason`} required rows={2} value={value.reason} onChange={(e) => set({ reason: e.target.value })} />
              </FormField>
            </>
          ) : null}
        </div>
      )}
      {minutes}
    </div>
  );
}
