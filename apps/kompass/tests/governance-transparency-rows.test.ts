import { describe, expect, it } from 'vitest';
import { transparencyRows } from '@/lib/governance/transparency-rows';

const view = (answers: Record<string, boolean>, promptlyBy: string | null = '2026-09-30') => ({ answers, checkedOn: null, confirmationDocumentId: null, extractDocumentIds: [], result: 'open' as const, promptlyBy, due: true });

describe('transparencyRows', () => {
  it('question 1 is the model turned around: notFiledPromptly false is yes, true is no, missing is open until the day', () => {
    expect(transparencyRows(view({ notFiledPromptly: false })).q1).toEqual({ value: 'yes', reason: 'submittedInTime', on: '2026-09-30' });
    expect(transparencyRows(view({ notFiledPromptly: true })).q1).toMatchObject({ value: 'no', reason: 'notInTime' });
    expect(transparencyRows(view({})).q1).toEqual({ value: 'open', reason: 'openUntil', on: '2026-09-30' });
  });
  it('Review Focus 4: all four “no” on the page is the model noReportNeeded — any “yes” is not', () => {
    const allNo = transparencyRows(view({ notFiledPromptly: false, foreignBoardMember: false, earlierOwnReport: false, controlOtherwise: false }));
    expect([allNo.q1.value, ...Object.values(allNo.manual)].every((v) => v === 'yes' || v === 'no')).toBe(true);
    expect(allNo.q1.value).toBe('yes');
    expect(Object.values(allNo.manual)).toEqual(['no', 'no', 'no']);
    expect(allNo.result).toBe('noReportNeeded');
    expect(transparencyRows(view({ notFiledPromptly: true, foreignBoardMember: false, earlierOwnReport: false, controlOtherwise: false })).result).toBe('reportNeeded');
    expect(transparencyRows(view({ notFiledPromptly: false, foreignBoardMember: true, earlierOwnReport: false, controlOtherwise: false })).result).toBe('reportNeeded');
    expect(transparencyRows(view({ notFiledPromptly: false })).manual).toEqual({ foreignBoardMember: null, earlierOwnReport: null, controlOtherwise: null });
  });
  it('0.5.0 Nr. 6: the report notice shows only once the checks count (submitted or registered)', () => {
    expect(transparencyRows(view({ foreignBoardMember: true })).reportNotice).toBe(true);
    expect(transparencyRows({ ...view({ foreignBoardMember: true }), due: false }).reportNotice).toBe(false);
    expect(transparencyRows(view({ foreignBoardMember: false })).reportNotice).toBe(false);
  });
});
