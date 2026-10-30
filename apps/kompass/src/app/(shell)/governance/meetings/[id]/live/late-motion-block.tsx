'use client';

import type { MeetingContext, MotionView, ResolutionView } from '@kompass/module-governance';
import type { PresentAt } from '@kompass/module-governance/live';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/forms/form-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { VoteTally, type VoteTallyValue } from '@/components/governance/vote-tally';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { SectionHeading } from '@/components/section';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { majorityText, ruleSource } from '@/lib/governance/majority-text';
import { tallyValueOf } from '@/lib/governance/live-model';
import { ITEM_KINDS } from '../agenda-item-dialog';

const STRICT = ['statute', 'purpose', 'dissolution'];

/**
 * Ein Antrag nach Frist oder aus der Versammlung (Board 1f, Spec § 5.3): zuerst die Abstimmung über die Aufnahme mit
 * der Mehrheit `lateMotionMajority`; die Art des künftigen TOP ist Pflicht und warnt, wenn sie angekündigt sein muss.
 * Angenommen, entsteht der TOP (Dienst) und die Sprungliste springt dorthin.
 */
export function LateMotionBlock({ motion, admission, context, present, kind, onKind, value, onChange, onCommit, readOnly, refusal }: { motion: MotionView; admission: ResolutionView | undefined; context: MeetingContext; present: PresentAt; kind: string; onKind: (kind: string) => void; value: VoteTallyValue | undefined; onChange: (next: VoteTallyValue) => void; onCommit: () => void; readOnly: boolean; refusal: ActionState | null }) {
  const t = useTranslations('governance.live.lateMotion');
  const tk = useTranslations('governance.agendaKinds');
  const tm = useTranslations('governance.majority');
  const rule = context.rules.lateMotion;
  const announce = (context.rules.announceRequired as string[]).includes(kind);
  const strictRule = (context.rules.majorityByKind as Record<string, typeof rule | undefined>)[kind];
  return (
    <div className="flex flex-col gap-4" data-testid="late-motion-block">
      <div className="flex flex-col gap-1">
        <Overline>{t('head')}</Overline>
        <SectionHeading>{motion.text.slice(0, 120)}</SectionHeading>
        <p className="text-meta text-ink-2">{t('rule', { majority: majorityText(tm, rule.value), source: ruleSource(tm, rule) })}</p>
      </div>
      <div className="whitespace-pre-line rounded-md bg-surface-2 p-3 text-body text-ink-2">{motion.text}</div>
      <FormField id={`late-kind-${motion.id}`} label={t('kind')} required>
        <Select id={`late-kind-${motion.id}`} value={kind} disabled={readOnly} onChange={(e) => onKind(e.target.value)}>
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>{tk(k)}</option>
          ))}
        </Select>
      </FormField>
      {announce ? <Notice level="warn">{STRICT.includes(kind) && strictRule ? t('notAnnouncedStrict', { kind: tk(kind), source: ruleSource(tm, strictRule) }) : t('notAnnounced')}</Notice> : null}
      {refusal ? <RefusalNotice state={refusal} /> : null}
      <VoteTally
        id={`motion-${motion.id}`}
        kind="agenda"
        unanimousLabel="adopted"
        voters={present.voting}
        presentVoting={present.voting}
        allVoting={context.rules.allVoting}
        excluded={0}
        majority={rule}
        tie={context.rules.tie}
        value={value ?? tallyValueOf(admission ?? null)}
        onChange={onChange}
        onCommit={onCommit}
        sentences={context.sentences[`motion:${motion.id}`] ?? []}
        time={admission?.votes ? admission.votedAt : null}
        readOnly={readOnly}
      />
    </div>
  );
}
