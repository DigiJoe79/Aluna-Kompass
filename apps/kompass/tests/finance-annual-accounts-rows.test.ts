import type { AnnualAccountsState } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { doneCount, publicationRows, type PublicationRow } from '@/app/(shell)/finance/reports/[key]/annual-accounts/publication-rows';

const final = { reportId: 'r1', documentId: 'd1', documentNumber: 'JRE-2026-001', finalizedAt: '2026-02-25T10:20:00.000Z', shortHash: '7d3e91ab', corrected: null };
const rep = { contactId: 'c-thomas', name: 'Thomas Wendt', office: 'Vorsitzender', roleId: 'role1', userId: 'u-thomas', mailState: 'ready' as const };
const signed = { reportId: 'r1', contactId: 'c-thomas', name: 'Thomas Wendt', office: 'Vorsitzender', signedOn: '2026-02-27', via: 'account' as const, documentId: 'd2', documentNumber: 'JRE-2026-001-A', scanDocumentId: null, scanDocumentNumber: null };
const publication = { id: 'p1', reportId: 'r1', fiscalYearId: 'y25', publishedAt: '2026-03-15T09:00:00.000Z', earlyReason: null, corrected: false, replacesFinalizedAt: null, webVersionOn: null, withdrawnAt: null, withdrawnCause: null, withdrawnLiveSince: null, liveSince: null };

function state(over: { finalVersion?: AnnualAccountsState['finalVersion']; explanation?: Partial<AnnualAccountsState['explanation']>; signature?: Partial<AnnualAccountsState['signature']>; website?: Partial<AnnualAccountsState['website']> } = {}): AnnualAccountsState {
  const finalVersion = over.finalVersion === undefined ? final : over.finalVersion;
  return {
    fiscalYearId: 'y25',
    designation: '2025',
    finalVersion,
    explanation: { state: 'done', length: 812, updatedAt: '2026-02-20T08:00:00.000Z', locked: finalVersion !== null, ...over.explanation },
    signature: { state: finalVersion ? 'open' : 'muted', mutedReason: finalVersion ? null : 'notFinal', signed: null, request: null, canSignSelf: false, representatives: [rep], ...over.signature },
    website: { state: 'muted', mutedReason: finalVersion ? 'notSigned' : 'notFinal', publication: null, previous: null, publishNeeds: 'nothing', blockedCode: null, mayPublish: true, assemblyOn: '2026-03-14', ...over.website },
    doneCount: 0,
  };
}
const anna = { userId: 'u-anna', canFinalize: true, canPublish: true };
const byKey = (rows: PublicationRow[]) => Object.fromEntries(rows.map((r) => [r.key, r])) as Record<PublicationRow['key'], PublicationRow>;
const signedState = (website: Partial<AnnualAccountsState['website']> = {}) => state({ signature: { state: 'done', signed }, website: { state: 'open', mutedReason: null, ...website } });

const fixtures: AnnualAccountsState[] = [
  state({ finalVersion: null, explanation: { state: 'open', length: 0, updatedAt: null } }),
  state(),
  state({ signature: { request: { contactId: 'c-thomas', name: 'Thomas Wendt', requestedOn: '2026-02-26', followUpId: 'f1', requestedByUserId: 'u-anna', assigneeUserId: 'u-thomas' } } }),
  signedState(),
  signedState({ state: 'done', publication: { ...publication, liveSince: '2026-03-16T08:00:00.000Z' } }),
  state({ finalVersion: { ...final, corrected: { replacesFinalizedAt: '2026-02-25T10:20:00.000Z' } }, website: { previous: { withdrawnAt: '2026-05-02T14:00:00.000Z', cause: 'voided', finalizedAt: '2026-02-25T10:20:00.000Z', wasLive: true } } }),
];

describe('publicationRows (Karte „Veröffentlichung“)', () => {
  it('three rows in fixed order in every state (Abnahme 1)', () => {
    for (const st of fixtures) {
      const rows = publicationRows(st, anna);
      expect(rows.map((r) => r.key)).toEqual(['explanation', 'signature', 'website']);
      for (const r of rows) expect(['done', 'open', 'muted']).toContain(r.show);
    }
  });

  it('before finalizing signature and website are muted with a reason and have no action (Abnahme 2)', () => {
    const rows = byKey(publicationRows(fixtures[0]!, anna));
    expect(rows.signature).toMatchObject({ show: 'muted', mutedReason: 'afterFinalize', actions: [] });
    expect(rows.website).toMatchObject({ show: 'muted', mutedReason: 'afterSignature', actions: [] });
    expect(rows.explanation).toMatchObject({ show: 'open', detail: 'explanationEmpty', actions: ['write'] });
  });

  it('explanation: edit before, view after finalizing; nothing to do when locked empty; no writing without the right', () => {
    expect(byKey(publicationRows(state({ finalVersion: null }), anna)).explanation).toMatchObject({ show: 'done', detail: 'explanationLength', actions: ['edit'], values: { count: 812 } });
    expect(byKey(publicationRows(state(), anna)).explanation).toMatchObject({ show: 'done', detail: 'explanationLocked', actions: ['view'] });
    expect(byKey(publicationRows(state({ explanation: { state: 'open', length: 0, updatedAt: null } }), anna)).explanation).toMatchObject({ show: 'done', detail: 'explanationNone', actions: [] });
    const reader = { userId: 'u-x', canFinalize: false, canPublish: false };
    expect(byKey(publicationRows(state({ finalVersion: null }), reader)).explanation.actions).toEqual(['view']);
    expect(byKey(publicationRows(state({ finalVersion: null, explanation: { state: 'open', length: 0, updatedAt: null } }), reader)).explanation.actions).toEqual([]);
  });

  it('sign only for representatives, request otherwise (Abnahme 3)', () => {
    expect(byKey(publicationRows(state({ signature: { canSignSelf: true } }), anna)).signature.actions).toEqual(['sign', 'request', 'scan']);
    const notRep = byKey(publicationRows(state(), anna)).signature;
    expect(notRep.actions[0]).toBe('request');
    expect(notRep.actions).not.toContain('sign');
    const reader = { userId: 'u-x', canFinalize: false, canPublish: false };
    expect(byKey(publicationRows(state(), reader)).signature.actions).toEqual([]);
    expect(byKey(publicationRows(state({ signature: { canSignSelf: true } }), reader)).signature.actions).toEqual(['sign']);
  });

  it('requested you / requested someone else', () => {
    const request = { contactId: 'c-thomas', name: 'Thomas Wendt', requestedOn: '2026-02-26', followUpId: 'f1', requestedByUserId: 'u-anna', assigneeUserId: 'u-thomas' };
    expect(byKey(publicationRows(state({ signature: { request } }), anna)).signature).toMatchObject({ detail: 'requested', values: { name: 'Thomas Wendt', date: '2026-02-26' } });
    expect(byKey(publicationRows(state({ signature: { request, canSignSelf: true } }), { userId: 'u-thomas', canFinalize: false, canPublish: false })).signature).toMatchObject({ detail: 'requestedYou', values: { requesterUserId: 'u-anna', date: '2026-02-26' } });
  });

  it('signed: done with the name, office and the number as link; scan names its number', () => {
    const row = byKey(publicationRows(signedState(), anna)).signature;
    expect(row).toMatchObject({ show: 'done', detail: 'signed', actions: [], link: { label: 'JRE-2026-001-A', href: '/dms/d2' }, values: { name: 'Thomas Wendt', office: 'Vorsitzender', date: '2026-02-27' } });
    const scan = byKey(publicationRows(state({ signature: { state: 'done', signed: { ...signed, via: 'scan', scanDocumentId: 'd3', scanDocumentNumber: 'JRE-2026-001-U' } } }), anna)).signature;
    expect(scan).toMatchObject({ detail: 'signedScan', values: { number: 'JRE-2026-001-U' } });
  });

  it('provided is not live (Abnahme 7)', () => {
    const provided = publicationRows(signedState({ publication }), anna);
    expect(byKey(provided).website).toMatchObject({ show: 'open', detail: 'provided', values: { date: publication.publishedAt } });
    expect(byKey(provided).website.actions).toEqual(['goToSite', 'retract']);
    const live = publicationRows(signedState({ state: 'done', publication: { ...publication, liveSince: '2026-03-16T08:00:00.000Z' } }), anna);
    expect(byKey(live).website).toMatchObject({ show: 'done', detail: 'live', actions: ['withdraw'] });
    expect(doneCount(provided)).toBe(2);
    // Ohne Recht zum Publizieren derselbe Satz, aber kein „Zur Webseite“ (Nachzug U1).
    expect(byKey(publicationRows(signedState({ publication }), { ...anna, canPublish: false })).website).toMatchObject({ show: 'open', detail: 'provided', actions: [] });
    expect(doneCount(live)).toBe(3);
  });

  it('a corrected version starts again and names the withdrawn one (Abnahme 8)', () => {
    const rows = byKey(publicationRows(fixtures[5]!, anna));
    expect(rows.signature).toMatchObject({ show: 'open', detail: 'notSignedCorrected' });
    expect(rows.website).toMatchObject({ show: 'muted', detail: 'withdrawnVoided', actions: [], values: { date: '2026-05-02T14:00:00.000Z' } });
  });

  it('a version that was only provided, never live, says the provision was retracted (Bildabnahme 0.4.5 F-2)', () => {
    const previous = { withdrawnAt: '2026-10-28T09:00:00.000Z', finalizedAt: '2026-02-25T10:20:00.000Z', wasLive: false };
    for (const [cause, detail] of [['voided', 'retractedVoided'], ['manual', 'retractedManual'], ['renderFailed', 'retractedRenderFailed']] as const) {
      const rows = byKey(publicationRows(state({ finalVersion: null, website: { previous: { ...previous, cause } } }), anna));
      expect(rows.website).toMatchObject({ show: 'muted', detail, values: { date: previous.withdrawnAt } });
    }
  });

  it('publish only with the right and when nothing blocks', () => {
    expect(byKey(publicationRows(signedState(), anna)).website).toMatchObject({ show: 'open', detail: 'notPublished', actions: ['publish'] });
    expect(byKey(publicationRows(signedState(), { ...anna, canPublish: false })).website.actions).toEqual([]);
    expect(byKey(publicationRows(signedState({ publishNeeds: 'blocked', blockedCode: 'annualAccountsAssemblyPending' }), anna)).website).toMatchObject({ show: 'open', detail: 'blocked', actions: [], values: { code: 'annualAccountsAssemblyPending' } });
  });
});
