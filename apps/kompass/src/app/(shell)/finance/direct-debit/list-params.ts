/** Die Query-Parameter der Seite „Lastschrift“ (Handoff 2a § 1.1): ein Reiter, je Reiter seine Filter. */
export interface DirectDebitQuery {
  view?: string;
  year?: string;
  state?: string;
  text?: string;
  bound?: string;
  page?: string;
}

export const DIRECT_DEBIT_VIEWS = ['runs', 'mandates', 'pledges'] as const;
export type DirectDebitView = (typeof DIRECT_DEBIT_VIEWS)[number];
export const PAGE_SIZE = 50;

/** Welche Filter ein Reiter kennt — das Jahr der Einzüge ist ein Rahmen, kein Filter (MUSTER § L). */
export const VIEW_FILTERS: Record<DirectDebitView, readonly ('year' | 'state' | 'text' | 'bound')[]> = {
  runs: ['year', 'state'],
  mandates: ['text', 'state'],
  pledges: ['text', 'state', 'bound'],
};

export const RUN_STATES = ['draft', 'fileCreated', 'submitted', 'booked', 'expired', 'cancelled'] as const;
export const MANDATE_STATES = ['pending', 'active', 'ended', 'expired'] as const;
export const PLEDGE_STATES = ['active', 'paused', 'ended'] as const;

export const viewOf = (q: DirectDebitQuery): DirectDebitView => DIRECT_DEBIT_VIEWS.find((v) => v === q.view) ?? 'runs';
export const offsetOf = (q: DirectDebitQuery) => (Math.max(1, Number(q.page) || 1) - 1) * PAGE_SIZE;

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | undefined => values.find((v) => v === value);

/** Zweckbindung im Filter: `general`, `purpose:<id>` oder `project:<id>`. */
export function boundInput(bound: string | undefined): { general?: true; purposeId?: string; projectId?: string } {
  if (bound === 'general') return { general: true };
  if (bound?.startsWith('purpose:')) return { purposeId: bound.slice(8) };
  if (bound?.startsWith('project:')) return { projectId: bound.slice(8) };
  return {};
}

export function runsInput(q: DirectDebitQuery, year: number) {
  const status = oneOf(RUN_STATES, q.state);
  return { year, ...(status ? { status } : {}), offset: offsetOf(q) };
}

export function mandatesInput(q: DirectDebitQuery) {
  const state = oneOf(MANDATE_STATES, q.state);
  const search = (q.text ?? '').trim().slice(0, 100);
  return { ...(state ? { state } : {}), ...(search ? { search } : {}), offset: offsetOf(q) };
}

export function pledgesInput(q: DirectDebitQuery) {
  const state = oneOf(PLEDGE_STATES, q.state);
  const search = (q.text ?? '').trim().slice(0, 100);
  return { ...(state ? { state } : {}), ...(search ? { search } : {}), ...boundInput(q.bound), offset: offsetOf(q) };
}
