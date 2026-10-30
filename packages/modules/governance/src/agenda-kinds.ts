import { RESOLUTION_KINDS } from './rules/schema';

/** Art eines Tagesordnungspunkts: eine Beschlussart oder ein Punkt ohne Beschluss (Spec § 4.2). */
export const AGENDA_KINDS = [...RESOLUTION_KINDS, 'report', 'discussion', 'other'] as const;
export type AgendaKind = (typeof AGENDA_KINDS)[number];
