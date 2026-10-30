import { evaluateMajority, type Majority, type MajorityResult, type ResolutionKind } from '@kompass/module-governance/live';

/** Bei diesen Arten zählt Ja nicht aus der Anwesenheit: Wer schweigt, stimmte sonst mit (Joe 2026-10-28). */
export const SELF_COUNT_KINDS: readonly ResolutionKind[] = ['statute', 'purpose', 'dissolution'];

export interface TallyInput {
  kind: ResolutionKind;
  /** Wer abstimmt: stimmberechtigt anwesend ohne Ausgeschlossene. */
  voters: number;
  /** Stimmberechtigt anwesend inkl. Ausgeschlossene (Bezugsgröße `present`). */
  presentVoting: number;
  allVoting: number;
  excluded: number;
  majority: Majority;
  tie: 'rejected' | 'chairDecides';
  no: number;
  abstain: number;
  invalid: number;
  /** `null` = errechnet (Subtraktionsverfahren). */
  yes: number | null;
}

export interface Tally {
  yes: number;
  yesComputed: boolean;
  /** Ja und Nein (bei „Enthaltung als Nein“ auch die Enthaltungen); ungültige zählen nie. */
  cast: number;
  result: MajorityResult;
  /** Genau auf der Schwelle: Mit einer Ja-Stimme weniger (dafür Nein) wäre es nicht erreicht. */
  knife: boolean;
  suggested: 'adopted' | 'rejected' | null;
  /** Nicht mehr Stimmen als Abstimmende. */
  valid: boolean;
}

/**
 * Die Ergebnis-Karte rechnet (Plan U1 Task 7, HANDOFF D1): Ja errechnet = Abstimmende − Nein − Enthaltung − ungültig;
 * die Mehrheit aus demselben Code wie im Dienst (`evaluateMajority`). Kompass schlägt vor, die Leitung stellt fest.
 */
export function computeTally(input: TallyInput): Tally {
  const yesComputed = input.yes === null;
  const yes = yesComputed ? input.voters - input.no - input.abstain - input.invalid : input.yes!;
  const valid = yes >= 0 && yes + input.no + input.abstain + input.invalid <= input.voters;
  const evaluate = (y: number, no = input.no) => evaluateMajority({ majority: input.majority, votes: { yes: y, no, abstain: input.abstain, invalid: input.invalid }, presentVoting: input.presentVoting, allVoting: input.allVoting, excluded: input.excluded, tie: input.tie });
  const result = evaluate(Math.max(0, yes));
  // Knapp: Stimmte eine Person mit Nein statt Ja, wäre es nicht erreicht (Board 1a, „Mit einer Ja-Stimme weniger …“).
  const knife = result.reached === true && yes > 0 && evaluate(yes - 1, input.no + 1).reached !== true;
  const cast = Math.max(0, yes) + input.no + (input.majority.abstentions === 'asNo' ? input.abstain : 0);
  return { yes, yesComputed, cast, result, knife, suggested: result.reached === null ? null : result.reached ? 'adopted' : 'rejected', valid };
}

export function selfCountByDefault(kind: ResolutionKind): boolean {
  return SELF_COUNT_KINDS.includes(kind);
}

/** Beschlussfähig genau auf der Schwelle („genau 11“, Board 1a/1h). */
export function quorumKnife(required: number | null, present: number): boolean {
  return required !== null && present === required;
}
