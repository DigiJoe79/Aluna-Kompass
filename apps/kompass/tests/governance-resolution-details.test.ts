import { describe, expect, it } from 'vitest';
import { DETAILS_KINDS, detailsDraft, detailsPayload } from '@/lib/governance/resolution-details';

const SAMPLES = {
  remuneration: { statuteReference: '§ 8 Satzung', decidedByOrganId: 'mv', officeIds: ['o1', 'o2'], mode: 'flat', amountCents: 84000, validFrom: '2026-01-01' },
  expenseRule: { basis: 'boardResolution', rule: 'Fahrten 0,30 € je km', validFrom: '2026-02-01' },
  reserve: { type: 'nr1', purpose: 'Neues Fahrzeug', amountCents: 500000, fiscalYearId: 'fy', action: 'create' },
  exclusion: { membershipId: 'm1', statuteGround: '§ 5 Abs. 3', reasonsSentOn: '2026-03-01', hearingOn: null, reasonsDocumentId: 'd1', noticeReceivedOn: null },
} as const;

describe('resolution details draft ↔ payload', () => {
  it('round trip per kind, amounts in cents', () => {
    for (const kind of DETAILS_KINDS) expect(detailsPayload(kind, detailsDraft(kind, SAMPLES[kind]))).toEqual(SAMPLES[kind]);
  });
  it('reserve nr1 without purpose is no payload; empty drafts are none', () => {
    expect(detailsPayload('reserve', detailsDraft('reserve', { ...SAMPLES.reserve, purpose: null }))).toBeNull();
    for (const kind of DETAILS_KINDS) expect(detailsPayload(kind, detailsDraft(kind, null))).toBeNull();
  });
  it('remuneration without a statute reference stays a valid payload', () => {
    expect(detailsPayload('remuneration', detailsDraft('remuneration', { ...SAMPLES.remuneration, statuteReference: null }))).toMatchObject({ statuteReference: null });
  });
});
