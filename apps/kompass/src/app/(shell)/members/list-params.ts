import type { MemberListView } from '@kompass/module-members';
import { readSort } from '@/lib/sort';

/** Die Query-Parameter der Mitgliederliste (Handoff Mitglieder 2.1). */
export interface MemberListQuery {
  view?: string;
  text?: string;
  type?: string;
  pay?: string;
  arrears?: string;
  rejected?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

export const MEMBER_VIEWS: readonly MemberListView[] = ['members', 'applications', 'left'];
export const PAGE_SIZE = 50;
const SORTABLE = ['name', 'number'] as const;

/** Welche Filter ein Reiter kennt: Anträge die Suche und „Auch abgelehnte“, Ausgetretene dazu die Art (Board 1c). */
export const VIEW_FILTERS: Record<MemberListView, readonly ('text' | 'type' | 'pay' | 'arrears' | 'rejected')[]> = {
  members: ['text', 'type', 'pay', 'arrears'],
  applications: ['text', 'rejected'],
  left: ['text', 'type'],
};

export const viewOf = (q: MemberListQuery): MemberListView => MEMBER_VIEWS.find((v) => v === q.view) ?? 'members';

/** URL → Eingabe für `listMemberOverview`; Unbekanntes wird überlesen, damit ein alter Link die Liste zeigt. */
export function memberListInput(q: MemberListQuery) {
  const view = viewOf(q);
  const allowed = VIEW_FILTERS[view];
  const text = (q.text ?? '').trim().slice(0, 200);
  const sort = readSort(q, SORTABLE);
  return {
    view,
    ...(text && allowed.includes('text') ? { search: text } : {}),
    ...(q.type && allowed.includes('type') ? { typeId: q.type } : {}),
    ...((q.pay === 'transfer' || q.pay === 'directDebit') && allowed.includes('pay') ? { paymentMethod: q.pay } : {}),
    ...(q.arrears === '1' && allowed.includes('arrears') ? { onlyArrears: true } : {}),
    ...(q.rejected === '1' && allowed.includes('rejected') ? { includeRejected: true } : {}),
    ...(sort ? { orderBy: sort } : {}),
    offset: (Math.max(1, Number(q.page) || 1) - 1) * PAGE_SIZE,
  };
}

/** Ob in diesem Reiter ein Filter wirkt — Sortierung und Seite sind keine. */
export function hasMemberFilter(q: MemberListQuery): boolean {
  const { view: _v, orderBy: _o, offset: _off, ...filters } = memberListInput(q);
  return Object.keys(filters).length > 0;
}

/** Auswahl im Filter „Mitgliedsart“: nur aktive Arten; eine abgeschaltete bleibt, solange sie gewählt ist (alter Link). */
export function typeFilterOptions(types: readonly { id: string; name: string; active: boolean }[], selected: string) {
  return types.filter((ty) => ty.active || ty.id === selected).map((ty) => ({ value: ty.id, label: ty.name }));
}
