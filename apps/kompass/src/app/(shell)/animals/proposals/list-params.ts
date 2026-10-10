import type { ProposalKind } from '@kompass/module-animals';

/** Die Arten als Liste für Filter und Prüfung; hier statt aus dem Modul, weil die Datei auch im Browser läuft. */
export const PROPOSAL_KIND_FILTER = ['create', 'update', 'notice', 'sameAs'] as const satisfies readonly ProposalKind[];

/** Die Query-Parameter der Inbox; dieselben reisen in Prüfseite und Stapel mit (Warteschlange). */
export const PROPOSAL_PARAM_KEYS = ['text', 'kind', 'source', 'state'] as const;
export type ProposalListQuery = Partial<Record<(typeof PROPOSAL_PARAM_KEYS)[number], string>>;
/** Zustand ist ein Rahmen (MUSTER § L), Vorgabe offen; `decided` = alles außer offen. */
export const PROPOSAL_STATE_FILTER = ['open', 'decided', 'accepted', 'acceptedWithChanges', 'rejected', 'replaced', 'withdrawn', 'all'] as const;
export type ProposalStateFilter = (typeof PROPOSAL_STATE_FILTER)[number];

const TEXT_MAX = 80;
const oneOf = <T extends string>(allowed: readonly T[], value: string | undefined): T | undefined => allowed.find((a) => a === value);

/** URL → Eingabe für `listProposals`. Unbekannte Werte werden überlesen: Ein veralteter Link zeigt die offenen. */
export function proposalListInput(q: ProposalListQuery): { state: ProposalStateFilter; kind?: ProposalKind; sourceUserId?: string; text?: string } {
  const input: { state: ProposalStateFilter; kind?: ProposalKind; sourceUserId?: string; text?: string } = { state: oneOf(PROPOSAL_STATE_FILTER, q.state) ?? 'open' };
  const kind = oneOf(PROPOSAL_KIND_FILTER, q.kind);
  if (kind) input.kind = kind;
  const source = (q.source ?? '').trim();
  if (source) input.sourceUserId = source;
  const text = (q.text ?? '').trim().slice(0, TEXT_MAX);
  if (text) input.text = text;
  return input;
}

/** Nur die bekannten, nicht leeren Parameter als Query-String ohne `?`; `state=open` ist die Vorgabe und fällt weg. */
export function proposalQueryString(q: Record<string, string | undefined>): string {
  const next = new URLSearchParams();
  for (const key of PROPOSAL_PARAM_KEYS) {
    const value = q[key];
    if (!value || (key === 'state' && value === 'open')) continue;
    next.set(key, value);
  }
  return next.toString();
}
