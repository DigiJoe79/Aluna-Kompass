import { formatAmount, parseAmount } from '@/lib/finance/amount';

/** Beschlussarten mit Angaben, die man in der Oberfläche einträgt (Plan U2 Task 12). */
export const DETAILS_KINDS = ['remuneration', 'expenseRule', 'reserve', 'exclusion'] as const;
export type DetailsKind = (typeof DETAILS_KINDS)[number];
export const isDetailsKind = (kind: string): kind is DetailsKind => (DETAILS_KINDS as readonly string[]).includes(kind);

export type DetailsDraft = {
  remuneration: { statuteReference: string; decidedByOrganId: string; officeIds: string[]; mode: 'flat' | 'activity'; amount: string; validFrom: string };
  expenseRule: { basis: 'statute' | 'contract' | 'boardResolution'; rule: string; validFrom: string };
  reserve: { type: 'nr1' | 'nr2' | 'nr3' | 'nr4'; purpose: string; amount: string; fiscalYearId: string; action: 'create' | 'withdraw' | 'dissolve' };
  exclusion: { membershipId: string; statuteGround: string; reasonsSentOn: string; hearingOn: string; reasonsDocumentId: string; noticeReceivedOn: string };
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const amountText = (v: unknown) => (typeof v === 'number' ? formatAmount(v) : '');
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

/** Angaben → Entwurf der Felder (leer, wenn noch keine). */
export function detailsDraft<K extends DetailsKind>(kind: K, details: unknown): DetailsDraft[K] {
  const d = (details ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'remuneration':
      return { statuteReference: str(d.statuteReference), decidedByOrganId: str(d.decidedByOrganId), officeIds: Array.isArray(d.officeIds) ? (d.officeIds as string[]) : [], mode: d.mode === 'activity' ? 'activity' : 'flat', amount: amountText(d.amountCents), validFrom: str(d.validFrom) } as DetailsDraft[K];
    case 'expenseRule':
      return { basis: (['statute', 'contract', 'boardResolution'].includes(str(d.basis)) ? d.basis : 'boardResolution') as DetailsDraft['expenseRule']['basis'], rule: str(d.rule), validFrom: str(d.validFrom) } as DetailsDraft[K];
    case 'reserve':
      return { type: (['nr1', 'nr2', 'nr3', 'nr4'].includes(str(d.type)) ? d.type : 'nr1') as DetailsDraft['reserve']['type'], purpose: str(d.purpose), amount: amountText(d.amountCents), fiscalYearId: str(d.fiscalYearId), action: (['create', 'withdraw', 'dissolve'].includes(str(d.action)) ? d.action : 'create') as DetailsDraft['reserve']['action'] } as DetailsDraft[K];
    default:
      return { membershipId: str(d.membershipId), statuteGround: str(d.statuteGround), reasonsSentOn: str(d.reasonsSentOn), hearingOn: str(d.hearingOn), reasonsDocumentId: str(d.reasonsDocumentId), noticeReceivedOn: str(d.noticeReceivedOn) } as DetailsDraft[K];
  }
}

/**
 * Entwurf → Angaben für den Dienst; `null`, solange ein Pflichtteil fehlt (**Claude**: lieber ohne Angaben als mit
 * halben — die Warnungen des Dienstes kommen, sobald etwas eingetragen ist).
 */
export function detailsPayload<K extends DetailsKind>(kind: K, draft: DetailsDraft[K]): unknown | null {
  switch (kind) {
    case 'remuneration': {
      const d = draft as DetailsDraft['remuneration'];
      const amountCents = parseAmount(d.amount);
      if (!d.decidedByOrganId || d.officeIds.length === 0 || amountCents === null || !d.validFrom) return null;
      return { statuteReference: orNull(d.statuteReference), decidedByOrganId: d.decidedByOrganId, officeIds: d.officeIds, mode: d.mode, amountCents, validFrom: d.validFrom };
    }
    case 'expenseRule': {
      const d = draft as DetailsDraft['expenseRule'];
      if (!d.rule.trim() || !d.validFrom) return null;
      return { basis: d.basis, rule: d.rule.trim(), validFrom: d.validFrom };
    }
    case 'reserve': {
      const d = draft as DetailsDraft['reserve'];
      const amountCents = parseAmount(d.amount);
      const purpose = orNull(d.purpose);
      if (amountCents === null || !d.fiscalYearId || ((d.type === 'nr1' || d.type === 'nr2') && purpose === null)) return null;
      return { type: d.type, purpose, amountCents, fiscalYearId: d.fiscalYearId, action: d.action };
    }
    default: {
      const d = draft as DetailsDraft['exclusion'];
      if (!d.membershipId) return null;
      return { membershipId: d.membershipId, statuteGround: orNull(d.statuteGround), reasonsSentOn: orNull(d.reasonsSentOn), hearingOn: orNull(d.hearingOn), reasonsDocumentId: orNull(d.reasonsDocumentId), noticeReceivedOn: orNull(d.noticeReceivedOn) };
    }
  }
}
