import { RESOLUTION_KINDS, resolveMajority, resolveRule, type OrganRuleKey, type OrganRules, type ReferenceKey, type ResolutionKind, type StatuteRules } from '@kompass/module-governance/live';
import type { OrganKind } from '@kompass/module-governance';

/**
 * Regelzeilen des Regelwerks (Board 5b/5c, Entscheidung 1 der Planprüfung: jede Regel des Schemas bekommt eine Zeile).
 * `notice` bündelt Frist, muss/soll, Fristbezug, Laufzeiten und Form; `majority.<Art>` die Mehrheit je Beschlussart.
 */
export type RuleRowKey =
  | 'convenedBy'
  | 'notice'
  | 'agendaWithInvitation'
  | 'motionDeadline'
  | 'lateMotion'
  | 'announceRequired'
  | 'formsAllowed'
  | 'ordinaryMeetingYearly'
  | 'repeatMeeting'
  | 'minorityRequest'
  | 'quorum'
  | `majority.${ResolutionKind}`
  | 'tie'
  | 'election'
  | 'chairOrder'
  | 'minutesSignedBy'
  | 'circular'
  | 'officeRequiresMembership'
  | 'substitution'
  | 'representation'
  | 'remuneration'
  | 'exclusionNotice';
export const RULE_GROUPS = ['convening', 'quorum', 'majorities', 'elections', 'chairAndMinutes', 'membershipAndOffices'] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];

export interface RuleRow {
  key: RuleRowKey;
  group: RuleGroup;
  organId: string;
  source: 'statute' | 'law';
  reference: string | null;
  norm: string | null;
  /** Die Schlüssel des Regelwerks, die die Zeile bearbeitet; der erste trägt die Fundstelle. */
  ruleKeys: (OrganRuleKey | `majorities.${ResolutionKind}`)[];
}

const NOTICE_KEYS: OrganRuleKey[] = ['noticeDays', 'noticeStrictness', 'noticeFrom', 'transitDays', 'form'];
/** Zeile → Schlüssel des Regelwerks (ohne Mehrheiten). */
const SIMPLE: Partial<Record<RuleRowKey, OrganRuleKey[]>> = {
  convenedBy: ['convenedBy'],
  notice: NOTICE_KEYS,
  agendaWithInvitation: ['agendaWithInvitation'],
  motionDeadline: ['motionDeadlineDays'],
  lateMotion: ['lateMotionMajority'],
  announceRequired: ['announceRequired'],
  formsAllowed: ['formsAllowed'],
  ordinaryMeetingYearly: ['ordinaryMeetingYearly'],
  repeatMeeting: ['repeatMeeting'],
  minorityRequest: ['minorityRequest'],
  quorum: ['quorum'],
  tie: ['tie'],
  election: ['election'],
  chairOrder: ['chairOrder'],
  minutesSignedBy: ['minutesSignedBy'],
  circular: ['circular'],
  officeRequiresMembership: ['officeRequiresMembership'],
  substitution: ['substitutionAllowed'],
  representation: ['representation'],
  remuneration: ['remuneration'],
  exclusionNotice: ['exclusionNoticeDays'],
};

/** Welche Zeilen ein Organ hat (**Claude**): die Versammlung alles außer Vorstandsregeln, der Vorstand seine, andere Organe das Allgemeine. */
function keysFor(kind: OrganKind): { key: RuleRowKey; group: RuleGroup }[] {
  const assembly = kind === 'assembly';
  const board = kind === 'board';
  const rows: { key: RuleRowKey; group: RuleGroup; when: boolean }[] = [
    { key: 'convenedBy', group: 'convening', when: true },
    { key: 'notice', group: 'convening', when: true },
    { key: 'agendaWithInvitation', group: 'convening', when: true },
    { key: 'motionDeadline', group: 'convening', when: assembly },
    { key: 'lateMotion', group: 'convening', when: assembly },
    { key: 'announceRequired', group: 'convening', when: true },
    { key: 'formsAllowed', group: 'convening', when: true },
    { key: 'ordinaryMeetingYearly', group: 'convening', when: assembly },
    { key: 'repeatMeeting', group: 'convening', when: assembly },
    { key: 'minorityRequest', group: 'convening', when: assembly },
    { key: 'quorum', group: 'quorum', when: true },
    ...RESOLUTION_KINDS.map((k) => ({ key: `majority.${k}` as RuleRowKey, group: 'majorities' as RuleGroup, when: k !== 'election' })),
    { key: 'tie', group: 'majorities', when: true },
    { key: 'election', group: 'elections', when: true },
    { key: 'chairOrder', group: 'chairAndMinutes', when: true },
    { key: 'minutesSignedBy', group: 'chairAndMinutes', when: true },
    { key: 'circular', group: 'chairAndMinutes', when: true },
    { key: 'officeRequiresMembership', group: 'membershipAndOffices', when: true },
    { key: 'substitution', group: 'membershipAndOffices', when: board },
    { key: 'representation', group: 'membershipAndOffices', when: board },
    { key: 'remuneration', group: 'membershipAndOffices', when: board },
    { key: 'exclusionNotice', group: 'membershipAndOffices', when: assembly },
  ];
  return rows.filter((r) => r.when).map(({ key, group }) => ({ key, group }));
}

/** Die Regelzeilen eines Organs mit Herkunft — Satzung (Fundstelle) oder Gesetz (Norm) über `resolveRule` des Moduls. */
export function ruleRowsFor(organ: { id: string; kind: OrganKind }, rules: StatuteRules): RuleRow[] {
  return keysFor(organ.kind).map(({ key, group }) => {
    if (key.startsWith('majority.')) {
      const kind = key.slice('majority.'.length) as ResolutionKind;
      const r = resolveMajority(rules, organ.id, kind);
      return { key, group, organId: organ.id, source: r.source, reference: r.reference ?? null, norm: r.source === 'law' ? (r.norm ?? null) : null, ruleKeys: [`majorities.${kind}`] };
    }
    const ruleKeys = SIMPLE[key]!;
    const resolved = ruleKeys.map((k) => resolveRule(rules, organ.id, k));
    const own = resolved.find((r) => r.source === 'statute');
    return { key, group, organId: organ.id, source: own ? 'statute' : 'law', reference: rules.references?.[organ.id]?.[ruleKeys[0]!] ?? own?.reference ?? null, norm: own ? null : (resolved[0]!.norm ?? null), ruleKeys };
  });
}

/**
 * Führt die Änderungen eines Organs ins Regelwerk zurück: ersetzt nur die genannten Schlüssel (Mehrheiten je Art),
 * entfernt `removed` samt Fundstelle (zurück zum Gesetz), setzt Fundstellen (leer → weg) und lässt alles andere —
 * andere Organe, `assetBeneficiary`, nicht bearbeitete Regeln — unverändert (Review Focus 1).
 */
export function mergeRules(original: StatuteRules, organId: string, edits: Partial<OrganRules>, removed: readonly (OrganRuleKey | `majorities.${ResolutionKind}`)[], references: Partial<Record<ReferenceKey, string | null>>): StatuteRules {
  const copy: StatuteRules = structuredClone(original);
  const organ: OrganRules = { ...(copy.organs[organId] ?? {}) };
  const { majorities, ...rest } = edits;
  Object.assign(organ, rest);
  if (majorities) organ.majorities = { ...(organ.majorities ?? {}), ...majorities };
  const refs: Partial<Record<ReferenceKey, string>> = { ...(copy.references?.[organId] ?? {}) };
  for (const key of removed) {
    if (key.startsWith('majorities.')) {
      const kind = key.slice('majorities.'.length) as ResolutionKind;
      if (organ.majorities) {
        const { [kind]: _gone, ...others } = organ.majorities;
        organ.majorities = others;
        if (Object.keys(others).length === 0) delete organ.majorities;
      }
    } else delete organ[key as OrganRuleKey];
    delete refs[key];
  }
  for (const [key, value] of Object.entries(references) as [ReferenceKey, string | null | undefined][]) {
    if (value === undefined) continue;
    if (value === null || value.trim() === '') delete refs[key];
    else refs[key] = value.trim();
  }
  copy.organs = { ...copy.organs, [organId]: organ };
  const allRefs = { ...(copy.references ?? {}) };
  if (Object.keys(refs).length > 0) allRefs[organId] = refs;
  else delete allRefs[organId];
  if (Object.keys(allRefs).length > 0) copy.references = allRefs;
  else delete copy.references;
  return copy;
}
