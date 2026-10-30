import { LAW_DEFAULT_MAJORITY, LAW_FALLBACK, LAW_MAJORITIES } from './law';
import type { Majority, OrganRuleKey, OrganRules, ResolutionKind, StatuteRules } from './schema';

export type RuleSource = 'statute' | 'law';
export interface ResolvedRule<T> {
  value: T;
  source: RuleSource;
  /** Bei Herkunft `law`: die Norm. */
  norm?: string;
  /** Bei Herkunft `statute`: die Fundstelle in der Satzung, wenn eingetragen. */
  reference?: string;
}

/**
 * Eine Regel eines Organs: der Wert der Satzung, sonst der Rückfallwert nach BGB. Ein fehlender Wert und ein
 * ausdrücklicher Satzungswert können dasselbe ergeben („ohne Quorum“), unterscheiden sich aber in der Herkunft.
 */
export function resolveRule<K extends OrganRuleKey>(rules: StatuteRules, organId: string, key: K): ResolvedRule<OrganRules[K] | undefined> {
  const value = rules.organs[organId]?.[key];
  if (value !== undefined) {
    const reference = rules.references?.[organId]?.[key];
    return { value, source: 'statute', ...(reference ? { reference } : {}) };
  }
  const fallback = LAW_FALLBACK[key];
  return { value: fallback.value as OrganRules[K] | undefined, source: 'law', norm: fallback.norm };
}

/** Die Mehrheit für eine Beschlussart: aus der Satzung, sonst nach BGB (einfache Mehrheit der abgegebenen Stimmen). */
export function resolveMajority(rules: StatuteRules, organId: string, kind: ResolutionKind): ResolvedRule<Majority> {
  const value = rules.organs[organId]?.majorities?.[kind];
  if (value !== undefined) {
    const reference = rules.references?.[organId]?.[`majorities.${kind}`];
    return { value, source: 'statute', ...(reference ? { reference } : {}) };
  }
  const law = LAW_MAJORITIES[kind] ?? LAW_DEFAULT_MAJORITY;
  return { value: law.value, source: 'law', norm: law.norm };
}

/** Muss die Beschlussart bei der Berufung angekündigt sein? (§ 32 Abs. 1 S. 2 BGB: Rückfall alle.) */
export function announceRequired(rules: StatuteRules, organId: string, kind: ResolutionKind): boolean {
  const rule = resolveRule(rules, organId, 'announceRequired').value ?? 'all';
  return rule === 'all' || rule.includes(kind);
}
