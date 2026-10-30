/**
 * Rechnung des Mitlaufs im Browser (Plan U1 Task 1, `@kompass/module-governance/live`): Mehrheit und Anwesenheit aus
 * demselben Code wie im Dienst. Zieht kein `@kompass/core` und keine Datenbank — aus Schema-Dateien nur `import type`.
 */
export { evaluateMajority, votesValid, type MajorityInput, type MajorityResult, type Votes } from '../majority';
export { fractionNeeded, RESOLUTION_KINDS, type Comparison, type Fraction, type Majority, type OrganRuleKey, type OrganRules, type ReferenceKey, type ResolutionKind, type StatuteRules } from '../rules/schema';
// Regelwerk im Browser (Plan U2, Regelwerk bearbeiten): Rückfall und Herkunft aus demselben Code wie im Dienst.
export { announceRequired, resolveMajority, resolveRule, type ResolvedRule, type RuleSource } from '../rules/resolve';
export { LAW_DEFAULT_MAJORITY, LAW_FALLBACK, LAW_MAJORITIES, LAW_NOTICE_HINT_DAYS, LAW_SIMPLE_MAJORITY } from '../rules/law';
export { presentFromRows, quorumPresent, type PresentAt, type QuorumBasis } from './presence';
