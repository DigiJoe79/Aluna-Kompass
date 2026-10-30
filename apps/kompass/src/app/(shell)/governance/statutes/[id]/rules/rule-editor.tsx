'use client';

import type { Majority, OrganRules, ResolutionKind } from '@kompass/module-governance/live';
import type { OrganKind, StatuteContextOrgan } from '@kompass/module-governance';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CountField } from '@/components/count-field';
import { FractionField, type FractionFieldBaseOption } from '@/components/governance/fraction-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fromMajority, fromQuorum, toMajority, toQuorum, type FractionValue } from '@/lib/governance/fraction';
import type { RuleRowKey } from '@/lib/governance/rule-rows';

const KINDS: ResolutionKind[] = ['simple', 'agenda', 'minutesApproval', 'statute', 'purpose', 'dissolution', 'election', 'dismissal', 'discharge', 'accounts', 'feeSchedule', 'exclusion', 'honoraryMember', 'mandate', 'reserve', 'remuneration', 'expenseRule'];
const FORMS = ['inPerson', 'hybrid', 'virtual'] as const;

/** Ein Kästchen mit Text daneben (MUSTER § J: Ankreuzfeld links). */
function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-body">
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  );
}

export interface EditorContext {
  organ: StatuteContextOrgan;
  /** Alle Organe (Vergütung: beschließendes Organ) und alle Ämter (Einberufung). */
  organs: StatuteContextOrgan[];
  label: string;
  error?: string;
}

/** Bezugsgrößen einer Mehrheit (vier; „aller Mitglieder“ bei der Versammlung = die stimmberechtigten, Planprüfung). */
export function majorityBases(t: (k: string, v?: Record<string, string | number>) => string, organ: StatuteContextOrgan): FractionFieldBaseOption[] {
  const f = organ.figures;
  const all = organ.kind === 'assembly' ? { value: 'allMembers' as const, label: t('bases.allVoting'), sample: f.voting, sampleLabel: t('samples.allVoting', { n: f.voting }) } : null;
  const organMembers = organ.kind === 'board' ? t('bases.board') : t('bases.organMembers');
  return [
    { value: 'cast', label: t('bases.cast'), sample: f.lastPresentVoting, sampleLabel: t('samples.cast', { n: f.lastPresentVoting ?? 0 }) },
    { value: 'presentVoting', label: t('bases.presentVoting'), sample: f.lastPresentVoting, sampleLabel: t('samples.presentVoting', { n: f.lastPresentVoting ?? 0 }) },
    ...(all ? [all] : []),
    ...(organ.kind !== 'assembly' ? [{ value: 'organMembers' as const, label: organMembers, sample: f.organMembers, sampleLabel: t('samples.organMembers', { n: f.organMembers }) }] : []),
  ];
}

function MajorityEditor({ id, ctx, value, onChange, kindOf, bases }: { id: string; ctx: EditorContext; value: Majority; onChange: (m: Majority) => void; kindOf: OrganKind; bases?: FractionFieldBaseOption[] }) {
  const t = useTranslations('governance.rulesEdit');
  const fv = fromMajority(value, kindOf);
  return (
    <div className="flex flex-col gap-2">
      <FractionField id={id} label={ctx.label} hideLabel value={fv} onChange={(v: FractionValue) => onChange(toMajority(v, value))} bases={bases ?? majorityBases(t, ctx.organ)} unit="yes" error={ctx.error} />
      {fv.base === 'cast' ? <Check id={`${id}-asno`} label={t('abstentionsAsNo')} checked={value.abstentions === 'asNo'} onChange={(c) => onChange({ ...value, abstentions: c ? 'asNo' : 'ignored' })} /> : null}
    </div>
  );
}

/** Die Eingabe einer eigenen Regel je Zeile (Board 5c, Planprüfung Entscheidung 1) — nur Bausteine aus dem Bestand und N8. */
export function RuleEditor({ rowKey, rules, set, ctx }: { rowKey: RuleRowKey; rules: OrganRules; set: (patch: Partial<OrganRules>) => void; ctx: EditorContext }) {
  const t = useTranslations('governance.rulesEdit');
  const tw = useTranslations('governance.rules.words');
  const tk = useTranslations('governance.agendaKinds');
  const id = `rule-${ctx.organ.id}-${rowKey.replace('.', '-')}`;
  const kind = ctx.organ.kind;
  const offices = ctx.organ.offices;
  const allOffices = ctx.organs.flatMap((o) => o.offices.map((x) => ({ ...x, organ: o.name })));
  const yesNo = (value: boolean | undefined, onChange: (v: boolean) => void) => (
    <Segmented<'yes' | 'no'> className="self-start" aria-label={ctx.label} value={value ? 'yes' : 'no'} onValueChange={(v) => onChange(v === 'yes')} options={[{ value: 'yes', label: tw('yes') }, { value: 'no', label: tw('no') }]} />
  );
  if (rowKey.startsWith('majority.')) {
    const k = rowKey.slice('majority.'.length) as ResolutionKind;
    const m = rules.majorities?.[k];
    if (!m) return null;
    return <MajorityEditor id={id} ctx={ctx} value={m} kindOf={kind} onChange={(v) => set({ majorities: { ...(rules.majorities ?? {}), [k]: v } })} />;
  }
  switch (rowKey) {
    case 'notice':
      return (
        <div className="flex flex-col gap-2">
          <span className="inline-flex flex-wrap items-center gap-2">
            <CountField id={`${id}-days`} aria-label={ctx.label} min={0} max={365} value={rules.noticeDays ?? ''} unit={t('daysBefore')} onChange={(e) => set({ noticeDays: Number(e.target.value) || 0 })} />
            <Select id={`${id}-form`} aria-label={t('form')} className="w-auto" value={rules.form ?? ''} onChange={(e) => set({ form: (e.target.value || undefined) as OrganRules['form'] })}>
              <option value="">{t('formNone')}</option>
              {(['textForm', 'letter', 'publication'] as const).map((f) => (
                <option key={f} value={f}>{tw(`forms.${f}`)}</option>
              ))}
            </Select>
          </span>
          <Segmented<'must' | 'should'> className="self-start" aria-label={t('strictness')} value={rules.noticeStrictness ?? 'must'} onValueChange={(v) => set({ noticeStrictness: v })} options={[{ value: 'must', label: t('must') }, { value: 'should', label: t('should') }]} />
          <span className="inline-flex flex-wrap items-center gap-2">
            <Select id={`${id}-from`} aria-label={t('noticeFrom')} className="w-auto" value={rules.noticeFrom ?? 'received'} onChange={(e) => set({ noticeFrom: e.target.value as 'sent' | 'received' })}>
              <option value="received">{tw('noticeFrom.received')}</option>
              <option value="sent">{tw('noticeFrom.sent')}</option>
            </Select>
            <CountField id={`${id}-post`} aria-label={t('transitPost')} min={0} max={30} value={rules.transitDays?.post ?? 3} unit={t('transitPostUnit')} onChange={(e) => set({ transitDays: { email: rules.transitDays?.email ?? 1, post: Number(e.target.value) || 0 } })} />
            <CountField id={`${id}-email`} aria-label={t('transitEmail')} min={0} max={30} value={rules.transitDays?.email ?? 1} unit={t('transitEmailUnit')} onChange={(e) => set({ transitDays: { post: rules.transitDays?.post ?? 3, email: Number(e.target.value) || 0 } })} />
          </span>
        </div>
      );
    case 'agendaWithInvitation':
      return yesNo(rules.agendaWithInvitation, (v) => set({ agendaWithInvitation: v }));
    case 'motionDeadline':
      return <CountField id={id} aria-label={ctx.label} min={0} max={365} value={rules.motionDeadlineDays ?? ''} unit={t('daysBefore')} onChange={(e) => set({ motionDeadlineDays: Number(e.target.value) || 0 })} />;
    case 'exclusionNotice':
      return <CountField id={id} aria-label={ctx.label} min={0} max={365} value={rules.exclusionNoticeDays ?? ''} unit={t('days')} onChange={(e) => set({ exclusionNoticeDays: Number(e.target.value) || 0 })} />;
    case 'lateMotion': {
      const m = rules.lateMotionMajority;
      if (!m) return null;
      const announce = rules.announceRequired ?? 'all';
      return (
        <div className="flex flex-col gap-1">
          <MajorityEditor id={id} ctx={ctx} value={m} kindOf={kind} onChange={(v) => set({ lateMotionMajority: v })} />
          <p className="text-meta text-muted-ink">{announce === 'all' ? t('lateAll') : t('lateExcept', { kinds: announce.map((k) => tk(k)).join(', ') || tw('announceNone') })}</p>
        </div>
      );
    }
    case 'announceRequired': {
      const list = rules.announceRequired === 'all' || rules.announceRequired === undefined ? [...KINDS] : rules.announceRequired;
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {KINDS.map((k) => (
            <Check key={k} id={`${id}-${k}`} label={tk(k)} checked={list.includes(k)} onChange={(c) => {
              const next = c ? [...list, k] : list.filter((x) => x !== k);
              set({ announceRequired: next.length === KINDS.length ? 'all' : next });
            }} />
          ))}
        </div>
      );
    }
    case 'formsAllowed': {
      const list = rules.formsAllowed ?? [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {FORMS.map((f) => (
            <Check key={f} id={`${id}-${f}`} label={tw(`meetingForms.${f}`)} checked={list.includes(f)} onChange={(c) => set({ formsAllowed: c ? [...list, f] : list.filter((x) => x !== f) })} />
          ))}
        </div>
      );
    }
    case 'convenedBy': {
      const list = rules.convenedBy?.officeIds ?? [];
      return (
        <div className="flex flex-col gap-2">
          <p className="text-meta text-muted-ink">{t('convenedHint')}</p>
          {allOffices.map((o) => (
            <Check key={o.id} id={`${id}-${o.id}`} label={`${o.name} (${o.organ})`} checked={list.includes(o.id)} onChange={(c) => set({ convenedBy: { officeIds: c ? [...list, o.id] : list.filter((x) => x !== o.id) } })} />
          ))}
        </div>
      );
    }
    case 'ordinaryMeetingYearly':
      return (
        <div className="flex flex-col gap-1">
          {yesNo(rules.ordinaryMeetingYearly, (v) => set({ ordinaryMeetingYearly: v }))}
          <p className="text-meta text-muted-ink">{t('ordinaryHint')}</p>
        </div>
      );
    case 'repeatMeeting': {
      const r = rules.repeatMeeting;
      return (
        <div className="flex flex-col gap-2">
          <Segmented<'none' | 'within'> className="self-start" aria-label={ctx.label} value={r ? 'within' : 'none'} onValueChange={(v) => set({ repeatMeeting: v === 'none' ? null : { withinDays: 28, noQuorum: true } })} options={[{ value: 'none', label: tw('repeatNone') }, { value: 'within', label: t('repeatWithin') }]} />
          {r ? (
            <>
              <CountField id={`${id}-days`} aria-label={t('repeatDays')} min={0} max={365} value={r.withinDays} unit={t('days')} onChange={(e) => set({ repeatMeeting: { ...r, withinDays: Number(e.target.value) || 0 } })} />
              <Check id={`${id}-noquorum`} label={t('repeatNoQuorum')} checked={r.noQuorum} onChange={(c) => set({ repeatMeeting: { ...r, noQuorum: c } })} />
            </>
          ) : null}
        </div>
      );
    }
    case 'minorityRequest': {
      const f = rules.minorityRequest ?? { num: 1, den: 10 };
      return <FractionField id={id} label={ctx.label} hideLabel value={{ comparison: 'atLeast', num: f.num, den: f.den, base: 'allMembers' }} onChange={(v) => set({ minorityRequest: { num: v.num, den: v.den } })} bases={[{ value: 'allMembers', label: t('bases.allMembers'), sample: ctx.organ.figures.allMembers, sampleLabel: t('samples.allMembers', { n: ctx.organ.figures.allMembers }) }]} error={ctx.error} />;
    }
    case 'quorum': {
      const q = rules.quorum ?? { kind: 'none' as const };
      const f = ctx.organ.figures;
      const bases: FractionFieldBaseOption[] =
        kind === 'assembly'
          ? [
              { value: 'allMembers', label: t('bases.allMembers'), sample: f.allMembers, sampleLabel: t('samples.allMembers', { n: f.allMembers }) },
              { value: 'votingMembers', label: t('bases.allVoting'), sample: f.voting, sampleLabel: t('samples.allVoting', { n: f.voting }) },
            ]
          : [{ value: 'organMembers', label: kind === 'board' ? t('bases.board') : t('bases.organMembers'), sample: f.organMembers, sampleLabel: t('samples.organMembers', { n: f.organMembers }) }];
      return (
        <div className="flex flex-col gap-2">
          <Select id={`${id}-kind`} aria-label={t('quorumKind')} className="w-auto self-start" value={q.kind} onChange={(e) => {
            const k = e.target.value as 'none' | 'fraction' | 'absolute';
            set({ quorum: k === 'none' ? { kind: 'none' } : k === 'absolute' ? { kind: 'absolute', count: 2 } : { kind: 'fraction', fraction: { num: 1, den: 2 }, base: kind === 'assembly' ? 'allMembers' : 'organMembers', comparison: 'atLeast' } });
          }}>
            <option value="fraction">{t('quorumFraction')}</option>
            <option value="absolute">{t('quorumAbsolute')}</option>
            <option value="none">{tw('quorumNone')}</option>
          </Select>
          {q.kind === 'fraction' ? <FractionField id={id} label={ctx.label} hideLabel value={fromQuorum(q)} onChange={(v) => set({ quorum: toQuorum(v) })} bases={bases} unit="present" error={ctx.error} /> : null}
          {q.kind === 'absolute' ? <CountField id={`${id}-count`} aria-label={ctx.label} min={1} max={1000} value={q.count} unit={t('present')} onChange={(e) => set({ quorum: { kind: 'absolute', count: Number(e.target.value) || 1 } })} /> : null}
        </div>
      );
    }
    case 'tie':
      return <Segmented<'rejected' | 'chairDecides'> className="self-start" aria-label={ctx.label} value={rules.tie ?? 'rejected'} onValueChange={(v) => set({ tie: v })} options={[{ value: 'rejected', label: tw('tie.rejected') }, { value: 'chairDecides', label: tw('tie.chairDecides') }]} />;
    case 'election': {
      const e = rules.election;
      if (!e) return null;
      return (
        <div className="flex flex-col gap-3">
          {e.rounds.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              <MajorityEditor id={`${id}-${i}`} ctx={{ ...ctx, label: t('round', { n: i + 1 }) }} value={r} kindOf={kind} onChange={(v) => set({ election: { ...e, rounds: e.rounds.map((x, j) => (j === i ? v : x)) } })} />
              {i > 0 ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('removeRound', { n: i + 1 })} onClick={() => set({ election: { ...e, rounds: e.rounds.filter((_, j) => j !== i) } })}>
                  <X className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
          ))}
          {e.rounds.length < 5 ? (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => set({ election: { ...e, rounds: [...e.rounds, { fraction: 'simple', base: 'cast', abstentions: 'ignored' }] } })}>
              {t('addRound')}
            </Button>
          ) : null}
          <Check id={`${id}-runoff`} label={t('runoff')} checked={e.runoff} onChange={(c) => set({ election: { ...e, runoff: c } })} />
        </div>
      );
    }
    case 'chairOrder': {
      const list = rules.chairOrder ?? [];
      return (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="inline-flex items-center gap-2">
              <span className="w-6 text-meta text-muted-ink">{i + 1}.</span>
              <Select id={`${id}-${i}`} aria-label={t('chairPosition', { n: i + 1 })} className="w-auto" value={list[i] ?? ''} onChange={(ev) => {
                const next = [...list];
                if (ev.target.value) next[i] = ev.target.value;
                else next.splice(i);
                set({ chairOrder: next.filter(Boolean) });
              }}>
                <option value="">{t('noOffice')}</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </span>
          ))}
        </div>
      );
    }
    case 'minutesSignedBy': {
      const list = rules.minutesSignedBy ?? [];
      const signers = [{ id: 'chair', name: tw('signers.chair') }, { id: 'minuteTaker', name: tw('signers.minuteTaker') }, ...offices];
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {signers.map((s) => (
              <Check key={s.id} id={`${id}-${s.id}`} label={s.name} checked={list.includes(s.id)} onChange={(c) => set({ minutesSignedBy: c ? [...list, s.id] : list.filter((x) => x !== s.id) })} />
            ))}
          </div>
          <p className="text-meta text-muted-ink">{t('signersHint')}</p>
        </div>
      );
    }
    case 'circular': {
      const c = rules.circular;
      const mode = !c || !c.allowed ? 'no' : c.consent === 'all' ? 'all' : 'majority';
      return (
        <div className="flex flex-col gap-2">
          <Segmented<'no' | 'all' | 'majority'> className="self-start" aria-label={ctx.label} value={mode} onValueChange={(v) => set({ circular: v === 'no' ? { allowed: false, consent: 'all', form: 'textForm' } : { allowed: true, consent: v === 'all' ? 'all' : { fraction: 'simple', base: 'all', abstentions: 'ignored' }, form: 'textForm' } })} options={[{ value: 'no', label: tw('circularNotAllowed') }, { value: 'all', label: tw('circularAll') }, { value: 'majority', label: t('circularMajority') }]} />
          {c && c.allowed && c.consent !== 'all' ? (
            <MajorityEditor id={id} ctx={ctx} value={c.consent} kindOf={kind === 'assembly' ? 'other' : kind} onChange={(v) => set({ circular: { ...c, consent: { ...v, base: 'all' } } })} bases={[{ value: 'organMembers', label: kind === 'board' ? t('bases.board') : t('bases.organMembers'), sample: ctx.organ.figures.organMembers || ctx.organ.figures.voting, sampleLabel: t('samples.organMembers', { n: ctx.organ.figures.organMembers || ctx.organ.figures.voting }) }]} />
          ) : null}
        </div>
      );
    }
    case 'officeRequiresMembership':
      return yesNo(rules.officeRequiresMembership, (v) => set({ officeRequiresMembership: v }));
    case 'substitution':
      return yesNo(rules.substitutionAllowed, (v) => set({ substitutionAllowed: v }));
    case 'representation': {
      const r = rules.representation ?? { mode: 'majority' as const };
      return (
        <div className="flex flex-col gap-2">
          <Segmented<'single' | 'two' | 'all' | 'majority'> className="self-start" aria-label={ctx.label} value={r.mode} onValueChange={(v) => set({ representation: { ...r, mode: v } })} options={(['single', 'two', 'all', 'majority'] as const).map((m) => ({ value: m, label: tw(`representation.${m}`) }))} />
          <Textarea id={`${id}-text`} aria-label={t('representationText')} rows={2} value={r.text ?? ''} onChange={(e) => set({ representation: { mode: r.mode, ...(e.target.value.trim() ? { text: e.target.value } : {}) } })} />
          <p className="text-meta text-muted-ink">{t('representationHint')}</p>
        </div>
      );
    }
    case 'remuneration': {
      const r = rules.remuneration;
      return (
        <div className="flex flex-col gap-2">
          <Segmented<'unpaid' | 'paid'> className="self-start" aria-label={ctx.label} value={r ? 'paid' : 'unpaid'} onValueChange={(v) => set({ remuneration: v === 'unpaid' ? null : { statuteReference: '§', decidedBy: ctx.organs.find((o) => o.kind === 'assembly')?.id ?? ctx.organ.id } })} options={[{ value: 'unpaid', label: tw('unpaid') }, { value: 'paid', label: t('paid') }]} />
          {r ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Input id={`${id}-ref`} aria-label={t('remunerationReference')} className="w-48" value={r.statuteReference} onChange={(e) => set({ remuneration: { ...r, statuteReference: e.target.value } })} />
              <Select id={`${id}-by`} aria-label={t('remunerationBy')} className="w-auto" value={r.decidedBy} onChange={(e) => set({ remuneration: { ...r, decidedBy: e.target.value } })}>
                {ctx.organs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </span>
          ) : null}
        </div>
      );
    }
    default:
      return null;
  }
}
