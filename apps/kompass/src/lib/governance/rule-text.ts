import { LAW_FALLBACK, RESOLUTION_KINDS, resolveMajority, resolveRule, type Majority, type OrganRuleKey, type OrganRules, type ResolutionKind, type StatuteRules } from '@kompass/module-governance/live';
import type { OrganKind } from '@kompass/module-governance';
import { majorityText } from './majority-text';
import type { RuleRowKey } from './rule-rows';

type T = (key: string, values?: Record<string, string | number>) => string;

/** Bruch in Klammern hinter einer Mehrheit in Worten (Board 5b: „drei Viertel der abgegebenen Stimmen (3/4)“). */
export function majorityWithFraction(tm: T, m: Majority): string {
  const text = majorityText(tm, m);
  return m.fraction === 'simple' ? text : `${text} (${m.fraction.num}/${m.fraction.den})`;
}

/**
 * Eine Regel in Worten für Lesesicht und Rückfall (Board 5b/5c). `t` im Namensraum `governance.rules.words`, `tm` in
 * `governance.majority`, `tk` in `governance.agendaKinds`; `office` nennt Ämter beim Namen. Ein fehlender Wert ist der
 * Rückfall des Gesetzes und wird von der Aufrufstelle schon aufgelöst übergeben.
 */
export function ruleText(key: RuleRowKey, rules: OrganRules, organKind: OrganKind, x: { t: T; tm: T; tk: T; office: (id: string) => string }): string {
  const { t, tm, tk, office } = x;
  const yesNo = (v: boolean | undefined | null) => t(v ? 'yes' : 'no');
  if (key.startsWith('majority.')) {
    const kind = key.slice('majority.'.length) as ResolutionKind;
    const m = rules.majorities?.[kind];
    return m ? majorityWithFraction(tm, m) : t('none');
  }
  switch (key) {
    case 'convenedBy': {
      const ids = rules.convenedBy?.officeIds ?? [];
      return ids.length ? ids.map(office).join(', ') : t('convenedByBoard');
    }
    case 'notice': {
      const parts: string[] = [];
      parts.push(rules.noticeDays === undefined ? t('noticeNone') : t('noticeDays', { n: rules.noticeDays, form: rules.form ? t(`forms.${rules.form}`) : 'none' }));
      if (rules.noticeStrictness === 'should') parts.push(t('noticeShould'));
      if (rules.noticeFrom) parts.push(t(`noticeFrom.${rules.noticeFrom}`));
      if (rules.transitDays) parts.push(t('transit', { post: rules.transitDays.post, email: rules.transitDays.email }));
      return parts.join(', ');
    }
    case 'agendaWithInvitation':
      return yesNo(rules.agendaWithInvitation ?? true);
    case 'motionDeadline':
      return rules.motionDeadlineDays === undefined ? t('noDeadline') : t('days', { n: rules.motionDeadlineDays });
    case 'lateMotion':
      return rules.lateMotionMajority ? majorityWithFraction(tm, rules.lateMotionMajority) : t('lateMotionNone');
    case 'announceRequired': {
      const a = rules.announceRequired ?? 'all';
      return a === 'all' ? t('announceAll') : a.length ? a.map((k) => tk(k)).join(', ') : t('announceNone');
    }
    case 'formsAllowed':
      return (rules.formsAllowed ?? ['inPerson', 'hybrid']).map((f) => t(`meetingForms.${f}`)).join(', ');
    case 'ordinaryMeetingYearly':
      return yesNo(rules.ordinaryMeetingYearly);
    case 'repeatMeeting':
      return rules.repeatMeeting ? t(rules.repeatMeeting.noQuorum ? 'repeatNoQuorum' : 'repeat', { n: rules.repeatMeeting.withinDays }) : t('repeatNone');
    case 'minorityRequest': {
      const f = rules.minorityRequest ?? { num: 1, den: 10 };
      return t('minority', { num: f.num, den: f.den });
    }
    case 'quorum': {
      const q = rules.quorum ?? { kind: 'none' as const };
      if (q.kind === 'none') return t('quorumNone');
      if (q.kind === 'absolute') return t('quorumAbsolute', { n: q.count });
      return t('quorumFraction', { comparison: tm(`comparison.${q.comparison ?? 'atLeast'}`), num: q.fraction.num, den: q.fraction.den, base: t(`quorumBase.${q.base === 'organMembers' && organKind === 'board' ? 'board' : q.base}`) });
    }
    case 'tie':
      return t(`tie.${rules.tie ?? 'rejected'}`);
    case 'election': {
      const e = rules.election;
      if (!e) return t('none');
      const rounds = e.rounds.map((r, i) => t('round', { n: i + 1, rule: majorityWithFraction(tm, r) })).join('; ');
      return e.runoff ? `${rounds}; ${t('runoff')}` : rounds;
    }
    case 'chairOrder':
      return rules.chairOrder?.length ? rules.chairOrder.map(office).join(', ') : t('notRegulated');
    case 'minutesSignedBy':
      return (rules.minutesSignedBy ?? ['chair', 'minuteTaker']).map((s) => (s === 'chair' || s === 'minuteTaker' ? t(`signers.${s}`) : office(s))).join(', ');
    case 'circular': {
      const c = rules.circular;
      if (!c || !c.allowed) return t('circularNotAllowed');
      return c.consent === 'all' ? t('circularAll') : majorityWithFraction(tm, c.consent);
    }
    case 'officeRequiresMembership':
      return yesNo(rules.officeRequiresMembership);
    case 'substitution':
      return yesNo(rules.substitutionAllowed);
    case 'representation': {
      const r = rules.representation ?? { mode: 'majority' as const };
      return [t(`representation.${r.mode}`), r.text].filter(Boolean).join(' — ');
    }
    case 'remuneration':
      return rules.remuneration ? t('remuneration', { reference: rules.remuneration.statuteReference }) : t('unpaid');
    case 'exclusionNotice':
      return rules.exclusionNoticeDays === undefined ? t('noDeadline') : t('days', { n: rules.exclusionNoticeDays });
  }
  return t('none');
}

/** Die Regeln eines Organs mit Rückfall: jeder Schlüssel und jede Mehrheit wie `resolveRule`/`resolveMajority` des Moduls. */
export function resolvedOrganRules(rules: StatuteRules, organId: string): OrganRules {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(LAW_FALLBACK) as OrganRuleKey[]) {
    if (key === 'majorities') continue;
    const value = resolveRule(rules, organId, key).value;
    if (value !== undefined) out[key] = value;
  }
  out.majorities = Object.fromEntries(RESOLUTION_KINDS.map((k) => [k, resolveMajority(rules, organId, k).value]));
  return out as OrganRules;
}
