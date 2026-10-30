'use client';

import { LAW_FALLBACK, LAW_NOTICE_HINT_DAYS, resolveMajority, resolveRule, type OrganRuleKey, type OrganRules, type ReferenceKey, type ResolutionKind, type StatuteRules } from '@kompass/module-governance/live';
import type { RulesChangePreview, StatuteContextOrgan } from '@kompass/module-governance';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Empty } from '@/components/empty-value';
import { FieldError } from '@/components/forms/field-error';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Overline } from '@/components/overline';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/notice';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { majorityText } from '@/lib/governance/majority-text';
import { mergeRules, RULE_GROUPS, ruleRowsFor, type RuleRow } from '@/lib/governance/rule-rows';
import { resolvedOrganRules, ruleText } from '@/lib/governance/rule-text';
import { previewStatuteRulesChangeAction, updateStatuteAction } from '../../actions';
import { RuleEditor } from './rule-editor';

type RuleKey = OrganRuleKey | `majorities.${ResolutionKind}`;
interface OrganDraft {
  rules: OrganRules;
  removed: RuleKey[];
  refs: Partial<Record<ReferenceKey, string | null>>;
}

/** Wert einer Zeile im Regelwerk (für Vergleich und Rückfall). */
function valuesOf(rules: OrganRules, row: RuleRow): unknown[] {
  return row.ruleKeys.map((k) => (k.startsWith('majorities.') ? rules.majorities?.[k.slice(11) as ResolutionKind] : rules[k as OrganRuleKey]));
}

/** Vorschlag beim Eintragen einer eigenen Regel: der Wert des Gesetzes, wo es keinen hat ein üblicher (**Claude**). */
function startValue(rules: StatuteRules, organId: string, row: RuleRow): Partial<OrganRules> {
  if (row.key.startsWith('majority.')) {
    const kind = row.key.slice(9) as ResolutionKind;
    return { majorities: { [kind]: resolveMajority(rules, organId, kind).value } };
  }
  const out: Partial<OrganRules> = {};
  for (const key of row.ruleKeys as OrganRuleKey[]) {
    const law = resolveRule(rules, organId, key).value;
    (out as Record<string, unknown>)[key] = law ?? LAW_FALLBACK[key].value;
  }
  const o = out as Record<string, unknown>;
  if (row.key === 'notice') o.noticeDays ??= LAW_NOTICE_HINT_DAYS;
  if (row.key === 'motionDeadline') o.motionDeadlineDays ??= 7;
  if (row.key === 'exclusionNotice') o.exclusionNoticeDays ??= 14;
  if (row.key === 'lateMotion') o.lateMotionMajority ??= { fraction: { num: 2, den: 3 }, base: 'cast', abstentions: 'ignored', comparison: 'atLeast' };
  if (row.key === 'convenedBy') o.convenedBy ??= { officeIds: [] };
  if (row.key === 'chairOrder') o.chairOrder ??= [];
  if (row.key === 'minutesSignedBy') o.minutesSignedBy ??= ['chair', 'minuteTaker'];
  return out;
}

/**
 * Regelwerk bearbeiten (Board 5c, Planprüfung Entscheidung 1): je Organ ein Abschnitt, je Regel eine Zeile in drei
 * Spalten — Bezeichnung · Regel · Fundstelle. Ohne Eintrag eine graue Fläche „laut Gesetz: …“ mit Norm und „Eigene Regel
 * eintragen“; eine eigene Regel geht mit × auf das Gesetz zurück. Gespeichert wird über `mergeRules` (nichts geht
 * verloren, Review Focus 1). Am eingetragenen oder abgelösten Stand (`locked`, G-5) verlangt eine Änderung einen Grund
 * im Warnkasten, der vorrechnet, welche festgeschriebenen Beschlüsse sie anders bewerten würde.
 */
export function RulesForm({ statuteId, rules, organs, locked = false }: { statuteId: string; rules: StatuteRules; organs: StatuteContextOrgan[]; locked?: boolean }) {
  const t = useTranslations('governance');
  const tw = useTranslations('governance.rules.words');
  const tm = useTranslations('governance.majority');
  const tk = useTranslations('governance.agendaKinds');
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(organs.map((o) => [o.id, { rules: structuredClone(rules.organs[o.id] ?? {}), removed: [], refs: {} } as OrganDraft])), [rules, organs]);
  const [drafts, setDrafts] = useState<Record<string, OrganDraft>>(initial);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState<RulesChangePreview | null>(null);
  const feedback = useActionFeedback();

  const merged = useMemo(() => organs.reduce((acc, o) => mergeRules(acc, o.id, drafts[o.id]!.rules, drafts[o.id]!.removed, drafts[o.id]!.refs), rules), [drafts, organs, rules]);
  const rowsOf = (o: StatuteContextOrgan) => ruleRowsFor(o, merged);
  const originalRows = (o: StatuteContextOrgan) => new Map(ruleRowsFor(o, rules).map((r) => [r.key, r]));
  const changedRows = organs.flatMap((o) => {
    const before = originalRows(o);
    return rowsOf(o).filter((r) => {
      const b = before.get(r.key)!;
      return JSON.stringify(valuesOf(merged.organs[o.id] ?? {}, r)) !== JSON.stringify(valuesOf(rules.organs[o.id] ?? {}, b)) || (r.reference ?? null) !== (b.reference ?? null);
    }).map((r) => `${o.id}:${r.key}`);
  });

  const changed = changedRows.length > 0;
  // G-5: Vorschau nur am eingetragenen Stand und nur bei einer Änderung, kurz entprellt.
  useEffect(() => {
    if (!locked || !changed) return;
    let live = true;
    const timer = setTimeout(() => void previewStatuteRulesChangeAction(statuteId, merged).then((p) => live && setImpact(p)), 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [locked, changed, merged, statuteId]);
  const judged = (j: { required: Parameters<typeof majorityText>[1]; reached: boolean | null }) => t('rulesEdit.judged', { majority: majorityText(tm, j.required), reached: j.reached === null ? 'open' : String(j.reached) });
  const impactLines = (impact?.affected ?? []).map((a) => t('rulesEdit.affectedLine', { number: a.number, before: judged(a.before), after: judged(a.after) }));

  const update = (organId: string, fn: (d: OrganDraft) => OrganDraft) => setDrafts((all) => ({ ...all, [organId]: fn(all[organId]!) }));
  const patch = (organId: string, p: Partial<OrganRules>) => update(organId, (d) => ({ ...d, rules: { ...d.rules, ...p } }));
  const own = (organ: StatuteContextOrgan, row: RuleRow) =>
    update(organ.id, (d) => {
      const start = startValue(merged, organ.id, row);
      const next = { ...d.rules, ...start, ...(start.majorities ? { majorities: { ...(d.rules.majorities ?? {}), ...start.majorities } } : {}) };
      return { ...d, rules: next, removed: d.removed.filter((k) => !row.ruleKeys.includes(k)) };
    });
  const toLaw = (organ: StatuteContextOrgan, row: RuleRow) =>
    update(organ.id, (d) => {
      const next: OrganRules = { ...d.rules };
      for (const k of row.ruleKeys) {
        if (k.startsWith('majorities.')) {
          const { [k.slice(11) as ResolutionKind]: _gone, ...rest } = next.majorities ?? {};
          next.majorities = rest;
        } else delete next[k as OrganRuleKey];
      }
      return { ...d, rules: next, removed: [...new Set([...d.removed, ...row.ruleKeys])], refs: { ...d.refs, [row.ruleKeys[0]!]: null } };
    });

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const errorOf = (organId: string, row: RuleRow) => {
    const prefixes = row.ruleKeys.map((k) => `rules.organs.${organId}.${k}`);
    return Object.entries(errors).find(([path]) => prefixes.some((p) => path === p || path.startsWith(`${p}.`)))?.[1];
  };
  const placed = Object.keys(errors).filter((path) => organs.some((o) => rowsOf(o).some((r) => r.ruleKeys.some((k) => path.startsWith(`rules.organs.${o.id}.${k}`)))));

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => updateStatuteAction({ id: statuteId, rules: merged, ...(locked ? { reason: reason.trim() } : {}) }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    setReason('');
    toast.success(result.message ?? '');
    router.refresh();
  };

  return (
    <FormCard>
      <FormCardBody>
        {organs.map((organ) => {
          const effective = resolvedOrganRules(merged, organ.id);
          const office = (id: string) => organs.flatMap((o) => o.offices).find((x) => x.id === id)?.name ?? id;
          const rows = rowsOf(organ);
          return (
            <Section key={organ.id} title={organ.name}>
              <div className="flex flex-col gap-5">
                {RULE_GROUPS.map((group) => {
                  const inGroup = rows.filter((r) => r.group === group);
                  if (inGroup.length === 0) return null;
                  return (
                    <div key={group} className="flex flex-col">
                      <Overline>{t(`rules.groups.${group}`)}</Overline>
                      <ul className="mt-2 flex flex-col">
                        {inGroup.map((row) => {
                          const label = t(`rules.labels.${row.key.startsWith('majority.') ? 'majority' : row.key}`, { kind: row.key.startsWith('majority.') ? tk(row.key.slice(9)) : '' });
                          const law = row.source === 'law';
                          const refKey = row.ruleKeys[0]!;
                          const ref = drafts[organ.id]!.refs[refKey] !== undefined ? (drafts[organ.id]!.refs[refKey] ?? '') : (row.reference ?? '');
                          return (
                            <li key={row.key} data-rule={`${organ.id}:${row.key}`} id={`rule-${row.key}`} className="grid gap-x-4 gap-y-2 border-b border-line-2 py-3 last:border-b-0 md:grid-cols-[12rem_minmax(0,1fr)_10rem]">
                              <span className="text-body text-ink-2">{label}</span>
                              {law ? (
                                <div className="flex flex-col items-start gap-2 rounded-md bg-surface-2 p-3 text-muted-ink">
                                  <span className="text-body">{t('statute.byLaw', { text: ruleText(row.key, effective, organ.kind, { t: tw, tm, tk, office }) })}</span>
                                  {row.norm ? <span className="text-meta">{row.norm}</span> : null}
                                  <Button type="button" variant="outline" size="sm" onClick={() => own(organ, row)}>{t('rulesEdit.own')}</Button>
                                </div>
                              ) : (
                                <div className="flex min-w-0 items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <RuleEditor rowKey={row.key} rules={merged.organs[organ.id] ?? {}} set={(p) => patch(organ.id, p)} ctx={{ organ, organs, label, error: errorOf(organ.id, row) }} />
                                    <FieldError id={`rule-${organ.id}-${row.key}-error`} message={row.key.startsWith('majority.') || row.key === 'quorum' || row.key === 'minorityRequest' ? undefined : errorOf(organ.id, row)} />
                                  </div>
                                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t('rulesEdit.toLaw')} onClick={() => toLaw(organ, row)}>
                                    <X className="size-4" aria-hidden />
                                  </Button>
                                </div>
                              )}
                              {law ? (
                                <span className="text-meta"><Empty /></span>
                              ) : (
                                <Input id={`rule-${organ.id}-${row.key}-ref`} aria-label={t('rulesEdit.reference', { rule: label })} placeholder={t('rulesEdit.referencePlaceholder')} value={ref} onChange={(e) => update(organ.id, (d) => ({ ...d, refs: { ...d.refs, [refKey]: e.target.value } }))} />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Section>
          );
        })}
        {locked && changed ? (
          <Notice level="warn" title={t('rulesEdit.lockedTitle', { count: impactLines.length })} reasons={impactLines} reason={{ name: 'rules-reason', value: reason, onChange: setReason, label: t('rulesEdit.reasonLabel') }}>
            {impactLines.length === 1 ? impactLines[0] : t('rulesEdit.lockedText')}
          </Notice>
        ) : null}
      </FormCardBody>
      <FormActionBar mode="edit" onSave={() => void save()} pending={pending} count={changedRows.length} onDiscard={() => setDrafts(initial)} state={withUnplacedFieldErrors(feedback.state, placed)} />
    </FormCard>
  );
}
