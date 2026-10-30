import type { AnnualAccountsState } from '@kompass/module-finance';

export type RowKey = 'explanation' | 'signature' | 'website';
export type RowAction = 'write' | 'edit' | 'view' | 'sign' | 'request' | 'scan' | 'publish' | 'goToSite' | 'withdraw' | 'retract';
export type RowDetail =
  | 'explanationEmpty'
  | 'explanationLength'
  | 'explanationLocked'
  | 'explanationNone'
  | 'notSigned'
  | 'notSignedCorrected'
  | 'requested'
  | 'requestedYou'
  | 'signed'
  | 'signedScan'
  | 'notPublished'
  | 'blocked'
  | 'provided'
  | 'live'
  | 'withdrawnVoided'
  | 'withdrawnManual'
  | 'withdrawnRenderFailed'
  | 'retractedVoided'
  | 'retractedManual'
  | 'retractedRenderFailed';

export interface PublicationRow {
  key: RowKey;
  show: 'done' | 'open' | 'muted';
  /** Satzcode für die Unterzeile; die Werte stehen in `values` (Tage als ISO, die Karte formatiert). */
  detail: RowDetail | null;
  values: Record<string, string | number>;
  mutedReason: 'afterFinalize' | 'afterSignature' | null;
  /** Erste Aktion = Knopf, weitere ins ⋯ der Zeile. */
  actions: RowAction[];
  /** Rechts als Link: die Nummer der abgezeichneten Fassung. */
  link: { label: string; href: string } | null;
}

export interface Viewer {
  userId: string;
  canFinalize: boolean;
  canPublish: boolean;
}

const row = (key: RowKey, over: Partial<PublicationRow>): PublicationRow => ({ key, show: 'open', detail: null, values: {}, mutedReason: null, actions: [], link: null, ...over });

const WITHDRAWN = { voided: 'withdrawnVoided', manual: 'withdrawnManual', renderFailed: 'withdrawnRenderFailed' } as const;
/** Nur bereitgestellt, nie auf der Webseite: kein „von der Webseite genommen“ (Bildabnahme 0.4.5 F-2). */
const RETRACTED = { voided: 'retractedVoided', manual: 'retractedManual', renderFailed: 'retractedRenderFailed' } as const;

/**
 * Was die drei Zeilen der Karte „Veröffentlichung“ zeigen (Designer 1a–1c, Rückmeldung Frage 1): immer drei, fest in
 * der Folge Erläuterung · Abzeichnung · Webseite. Rein — trägt die Abnahmepunkte 1–3, 7 und 8 ohne DOM.
 */
export function publicationRows(state: AnnualAccountsState, me: Viewer): PublicationRow[] {
  return [explanationRow(state, me), signatureRow(state, me), websiteRow(state, me)];
}

/** „n von 3 erledigt“: zählt die Zeilen der Karte — bereitgestellt ist offen, nicht erledigt (Board 1c A). */
export function doneCount(rows: readonly PublicationRow[]): number {
  return rows.filter((r) => r.show === 'done').length;
}

function explanationRow(state: AnnualAccountsState, me: Viewer): PublicationRow {
  const { length, locked } = state.explanation;
  if (locked) return length > 0 ? row('explanation', { show: 'done', detail: 'explanationLocked', values: { count: length }, actions: ['view'] }) : row('explanation', { show: 'done', detail: 'explanationNone' });
  if (length === 0) return row('explanation', { detail: 'explanationEmpty', actions: me.canFinalize ? ['write'] : [] });
  return row('explanation', { show: 'done', detail: 'explanationLength', values: { count: length }, actions: me.canFinalize ? ['edit'] : ['view'] });
}

function signatureRow(state: AnnualAccountsState, me: Viewer): PublicationRow {
  const sig = state.signature;
  if (!state.finalVersion) return row('signature', { show: 'muted', mutedReason: 'afterFinalize' });
  if (sig.signed) {
    const s = sig.signed;
    const values: Record<string, string> = { name: s.name, office: s.office ?? '', date: s.signedOn };
    if (s.via === 'scan' && s.scanDocumentNumber) values.number = s.scanDocumentNumber;
    return row('signature', { show: 'done', detail: s.via === 'scan' ? 'signedScan' : 'signed', values, link: { label: s.documentNumber, href: `/dms/${s.documentId}` } });
  }
  const request = sig.request;
  const detail: RowDetail = request ? (request.assigneeUserId === me.userId ? 'requestedYou' : 'requested') : state.finalVersion.corrected ? 'notSignedCorrected' : 'notSigned';
  const values: Record<string, string> = request ? (detail === 'requestedYou' ? { requesterUserId: request.requestedByUserId, date: request.requestedOn } : { name: request.name, date: request.requestedOn }) : {};
  const actions: RowAction[] = [...(sig.canSignSelf ? (['sign'] as const) : []), ...(me.canFinalize ? (['request', 'scan'] as const) : [])];
  return row('signature', { detail, values, actions });
}

function websiteRow(state: AnnualAccountsState, me: Viewer): PublicationRow {
  const web = state.website;
  const previous = web.previous;
  if (!state.finalVersion || !state.signature.signed) {
    return row('website', { show: 'muted', mutedReason: 'afterSignature', ...(previous ? { detail: (previous.wasLive ? WITHDRAWN : RETRACTED)[previous.cause], values: { date: previous.withdrawnAt } } : {}) });
  }
  const pub = web.publication;
  if (pub?.liveSince) return row('website', { show: 'done', detail: 'live', values: { date: pub.liveSince }, actions: me.canPublish ? ['withdraw'] : [] });
  // Nur bereitgestellt: „Bereitstellung zurücknehmen …“ — von der Webseite nehmen lässt sich nur, was dort stand (Abnahme B1, Nachzug 3).
  if (pub) return row('website', { detail: 'provided', values: { date: pub.publishedAt }, actions: me.canPublish ? ['goToSite', 'retract'] : [] });
  if (web.publishNeeds === 'blocked') return row('website', { detail: 'blocked', values: { code: web.blockedCode ?? '' } });
  return row('website', { detail: 'notPublished', actions: me.canPublish ? ['publish'] : [] });
}
