'use client';

import type { MeetingContext, ResolutionView } from '@kompass/module-governance';
import type { PresentAt } from '@kompass/module-governance/live';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { FixedValue } from '@/components/fixed-value';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { VoteTally, type VoteTallyValue } from '@/components/governance/vote-tally';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Segmented } from '@/components/ui/segmented';
import type { ActionState } from '@/lib/actions';
import { dischargeLabels, dischargeModeLocked, tallyValueOf } from '@/lib/governance/live-model';

type Details = { fiscalYearId: string; mode: 'individual' | 'collective'; contactIds: string[] };
export type DischargeTarget = { key: string; target: string | null; contactIds: string[]; resolution: ResolutionView | undefined };

/**
 * Entlastung im Mitlauf (Board 1e): gemeinsam oder einzeln (fest mit der ersten Abstimmung, Review Focus 5),
 * „Stimmen nicht mit …“ vorbelegt aus den Finanzen, je Beschluss eine Ergebnis-Karte „Einstimmig entlastet“; die
 * Betroffenen zählen nicht mit, bleiben aber für die Beschlussfähigkeit anwesend.
 */
export function DischargeBlock({
  meetingId,
  item,
  context,
  resolutions,
  present,
  people,
  values,
  readOnly,
  refusal,
  onChange,
  onCommit,
}: {
  meetingId: string;
  item: { id: string; position: number; fiscalYearId: string | null };
  context: MeetingContext;
  resolutions: ResolutionView[];
  present: PresentAt;
  /** Die Anwesenden — auch sie lassen sich als Betroffene wählen. */
  people: { id: string; name: string }[];
  values: Record<string, VoteTallyValue>;
  readOnly: boolean;
  refusal: ActionState | null;
  onChange: (target: DischargeTarget, mode: 'individual' | 'collective', all: string[], next: VoteTallyValue) => void;
  onCommit: () => void;
}) {
  const t = useTranslations('governance.live.discharge');
  const locked = dischargeModeLocked(resolutions, item.id);
  const own = resolutions.filter((r) => r.agendaItemId === item.id && r.kind === 'discharge');
  const lockedMode = (own[0]?.details as Details | null)?.mode;
  const [mode, setMode] = useState<'individual' | 'collective'>(lockedMode ?? 'collective');
  const [chosen, setChosen] = useState<string[]>(() => (own.length ? own.flatMap((r) => (r.details as Details).contactIds) : (context.discharge[item.id] ?? [])));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(chosen);
  const effectiveMode = lockedMode ?? mode;
  const labels = dischargeLabels(own, item.position);
  const majority = context.rules.majorities[item.id];

  if (!item.fiscalYearId) {
    return (
      <Notice level="warn" action={<Link href={`/governance/meetings/${meetingId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('toMeeting')}</Link>}>
        {t('noYear')}
      </Notice>
    );
  }
  if (!majority) return null;
  const names = (ids: string[]) => ids.map((id) => context.names[id] ?? '').join(', ');
  const targets: DischargeTarget[] =
    effectiveMode === 'collective'
      ? [{ key: `discharge:${item.id}`, target: null, contactIds: chosen, resolution: own[0] }]
      : chosen.map((id) => ({ key: `discharge:${item.id}:${id}`, target: id, contactIds: [id], resolution: own.find((r) => (r.details as Details).contactIds[0] === id) }));
  const candidates = [...new Set([...(context.discharge[item.id] ?? []), ...chosen, ...people.map((p) => p.id)])];
  const personName = (id: string) => context.names[id] ?? people.find((p) => p.id === id)?.name ?? '';

  return (
    <div className="flex flex-col gap-4" data-testid="discharge-block">
      {refusal ? <RefusalNotice state={refusal} /> : null}
      {locked ? (
        <FixedValue id={`discharge-mode-${item.id}`} label={t('mode')} value={t('modeFixed', { mode: t(`modes.${effectiveMode}`) })} reason={t('modeFixedReason')} />
      ) : (
        <FormField id={`discharge-mode-${item.id}`} label={t('mode')}>
          <Segmented className="self-start" aria-label={t('mode')} disabled={readOnly} value={mode} onValueChange={setMode} options={(['collective', 'individual'] as const).map((m) => ({ value: m, label: t(`modes.${m}`) }))} />
        </FormField>
      )}
      {chosen.length === 0 ? <Notice level="warn">{t('nobody')}</Notice> : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-meta text-ink-2">{t('notVoting', { names: names(chosen) })}</p>
          {!locked && !readOnly ? <Button type="button" variant="outline" size="sm" onClick={() => { setDraft(chosen); setEditing(true); }}>{t('change')}</Button> : null}
        </div>
      )}
      {targets.map((target) => {
        const awayPresent = target.contactIds.filter((id) => present.votingContactIds.includes(id)).length;
        const label = effectiveMode === 'collective' ? t('labelCollective', { names: names(target.contactIds) }) : t('label', { label: target.resolution ? (labels[target.resolution.id] ?? '') : `${item.position}${String.fromCharCode(97 + chosen.indexOf(target.target!))}`, name: names(target.contactIds) });
        return (
          <div key={target.key} className="flex flex-col gap-2">
            <Overline>{label}</Overline>
            {target.resolution?.warnings.includes('alreadyDischarged') ? <Notice level="warn">{t('alreadyDischarged')}</Notice> : null}
            <VoteTally
              id={target.key.replace(/:/g, '-')}
              kind="discharge"
              unanimousLabel="discharged"
              voters={present.voting - awayPresent}
              presentVoting={present.voting}
              allVoting={context.rules.allVoting}
              excluded={awayPresent}
              majority={majority}
              tie={context.rules.tie}
              value={values[target.key] ?? tallyValueOf(target.resolution ?? null)}
              onChange={(next) => onChange(target, effectiveMode, chosen, next)}
              onCommit={onCommit}
              sentences={[]}
              time={target.resolution?.votedAt ?? null}
              readOnly={readOnly}
            />
          </div>
        );
      })}
      <ConfirmDialog
        open={editing}
        onOpenChange={setEditing}
        title={t('dialog.title')}
        description={t('dialog.description')}
        confirmLabel={t('dialog.confirm')}
        action={async () => {
          setChosen(draft);
          return { status: 'success' };
        }}
      >
        <ul className="flex flex-col gap-2">
          {candidates.map((id) => (
            <li key={id}>
              <FormField id={`discharge-person-${id}`} label={personName(id)} toggle size="full">
                <Checkbox id={`discharge-person-${id}`} checked={draft.includes(id)} onCheckedChange={(on) => setDraft((d) => (on === true ? [...d, id] : d.filter((x) => x !== id)))} />
              </FormField>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
