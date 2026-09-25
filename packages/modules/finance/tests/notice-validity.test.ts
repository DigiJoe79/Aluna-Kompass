import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { noticeValidAt, noticeValidUntil, type NoticeValidityInput } from '../src/ledger/notice-validity';

const notice = (o: Partial<NoticeValidityInput> & Pick<NoticeValidityInput, 'kind' | 'noticeDate'>): NoticeValidityInput => ({ supersededOn: null, voidedAt: null, ...o });

describe('noticeValidUntil', () => {
  it('ends three years after a section 60a notice, day-exact, inclusive', () => {
    expect(noticeValidUntil('section60a', '2024-03-15')).toBe('2027-03-15');
  });

  it('ends five years after an exemption notice', () => {
    expect(noticeValidUntil('exemptionNotice', '2024-03-15')).toBe('2029-03-15');
    expect(noticeValidUntil('corporateTaxNoticeAttachment', '2023-11-30')).toBe('2028-11-30');
  });

  it('handles february 29 by ending on february 28 of the target year', () => {
    expect(noticeValidUntil('section60a', '2024-02-29')).toBe('2027-02-28');
    expect(noticeValidUntil('exemptionNotice', '2024-02-29')).toBe('2029-02-28');
    // Fällt das Zieljahr wieder auf ein Schaltjahr, bleibt der 29.
    expect(noticeValidUntil('exemptionNotice', '2020-02-29')).toBe('2025-02-28');
    expect(noticeValidUntil('section60a', '2021-02-28')).toBe('2024-02-28');
  });
});

describe('noticeValidAt', () => {
  it('the day before, the day, the day after', () => {
    const n = notice({ kind: 'section60a', noticeDate: '2024-03-15' });
    expect(noticeValidAt([n], '2024-03-14')).toBeNull();
    expect(noticeValidAt([n], '2024-03-15')).toEqual({ notice: n, validUntil: '2027-03-15' });
    expect(noticeValidAt([n], '2027-03-15')).toEqual({ notice: n, validUntil: '2027-03-15' });
    expect(noticeValidAt([n], '2027-03-16')).toBeNull();
  });

  it('picks the youngest valid notice', () => {
    const older = notice({ kind: 'exemptionNotice', noticeDate: '2022-05-02' });
    const younger = notice({ kind: 'exemptionNotice', noticeDate: '2025-05-02' });
    expect(noticeValidAt([younger, older], '2024-01-01')?.notice).toBe(older);
    expect(noticeValidAt([older, younger], '2026-01-01')?.notice).toBe(younger);
  });

  it('a section 60a notice stops counting once a later exemption notice exists', () => {
    const provisional = notice({ kind: 'section60a', noticeDate: '2024-01-10' });
    const exemption = notice({ kind: 'exemptionNotice', noticeDate: '2025-06-01' });
    expect(noticeValidAt([provisional, exemption], '2025-05-31')?.notice).toBe(provisional);
    expect(noticeValidAt([provisional, exemption], '2025-06-01')?.notice).toBe(exemption);
    // Auch wenn der Freistellungsbescheid selbst später ersetzt wird, lebt § 60a nicht wieder auf.
    const supersededExemption = notice({ kind: 'corporateTaxNoticeAttachment', noticeDate: '2025-06-01', supersededOn: '2025-09-01' });
    expect(noticeValidAt([provisional, supersededExemption], '2025-10-01')).toBeNull();
    // Ein irrtümlich erfasster Freistellungsbescheid beendet § 60a nicht.
    const voidedExemption = notice({ kind: 'exemptionNotice', noticeDate: '2025-06-01', voidedAt: '2025-06-02T08:00:00.000Z' });
    expect(noticeValidAt([provisional, voidedExemption], '2025-10-01')?.notice).toBe(provisional);
  });

  it('ignores voided and superseded notices from their date on', () => {
    const superseded = notice({ kind: 'exemptionNotice', noticeDate: '2024-01-10', supersededOn: '2025-03-01' });
    expect(noticeValidAt([superseded], '2025-02-28')?.notice).toBe(superseded);
    expect(noticeValidAt([superseded], '2025-03-01')).toBeNull();
    // Irrtümlich erfasst heißt: nie gültig gewesen — auch nicht vor dem Tag der Erkenntnis.
    const voided = notice({ kind: 'exemptionNotice', noticeDate: '2024-01-10', voidedAt: '2025-03-01T08:00:00.000Z' });
    expect(noticeValidAt([voided], '2024-06-01')).toBeNull();
    expect(noticeValidAt([voided], '2025-06-01')).toBeNull();
  });
});

describe('notice validity purity', () => {
  it('imports nothing — no @kompass/*, no relative path', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/ledger/notice-validity.ts'), 'utf8');
    const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(imports).toEqual([]);
  });
});
