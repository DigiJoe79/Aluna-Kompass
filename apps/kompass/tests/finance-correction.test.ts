import { describe, expect, it } from 'vitest';
import { changesOf, correctionPath, selectableLines, type CorrectableLine } from '@/lib/finance/correction';

describe('changesOf', () => {
  it('reports only fields that really changed, and an empty object when nothing did', () => {
    const line: CorrectableLine = { id: 'l1', contactId: 'c1', projectId: null, purposeId: 'p1', abroad: false, pendingCorrectionId: null };
    expect(changesOf(line, { contactId: 'c1', projectId: null, purposeId: 'p1', abroad: false })).toEqual({});
    expect(changesOf(line, { contactId: 'c2', projectId: null, purposeId: 'p1', abroad: false })).toEqual({ contactId: 'c2' });
    expect(changesOf(line, { contactId: 'c1', projectId: 'proj-1', purposeId: 'p1', abroad: true })).toEqual({ projectId: 'proj-1', abroad: true });
  });

  it('treats null and a value as a change in both directions', () => {
    const withoutContact: CorrectableLine = { id: 'l1', contactId: null, projectId: null, purposeId: null, abroad: false, pendingCorrectionId: null };
    expect(changesOf(withoutContact, { contactId: 'c9', projectId: null, purposeId: null, abroad: false })).toEqual({ contactId: 'c9' });

    const withContact: CorrectableLine = { ...withoutContact, contactId: 'c9' };
    expect(changesOf(withContact, { contactId: null, projectId: null, purposeId: null, abroad: false })).toEqual({ contactId: null });
  });
});

describe('selectableLines', () => {
  it('leaves lines with a pending correction unselectable', () => {
    const lines: CorrectableLine[] = [
      { id: 'a', contactId: null, projectId: null, purposeId: null, abroad: false, pendingCorrectionId: null },
      { id: 'b', contactId: null, projectId: null, purposeId: null, abroad: false, pendingCorrectionId: 'corr-1' },
      { id: 'c', contactId: null, projectId: null, purposeId: null, abroad: false, pendingCorrectionId: null },
    ];
    expect(selectableLines(lines).map((l) => l.id)).toEqual(['a', 'c']);
  });
});

describe('correctionPath', () => {
  it('chooses reverse as soon as one of the numbers is picked, even with allocation picks', () => {
    expect(correctionPath({ allocation: ['contact'], numbers: ['amount'] })).toBe('reverse');
    expect(correctionPath({ allocation: [], numbers: ['date'] })).toBe('reverse');
  });

  it('chooses allocation when only allocation fields are picked', () => {
    expect(correctionPath({ allocation: ['contact', 'project'], numbers: [] })).toBe('allocation');
  });

  it('is null when nothing is picked', () => {
    expect(correctionPath({ allocation: [], numbers: [] })).toBeNull();
  });
});
