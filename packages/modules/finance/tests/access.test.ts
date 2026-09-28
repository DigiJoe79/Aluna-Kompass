import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { requireFinanceRead } from '../src/ledger/access';

describe('requireFinanceRead', () => {
  it('overview is the smaller right: read opens it too, but not the other way round', () => {
    expect(requireFinanceRead(ctxWith(['finance.overview']), 'overview')).toBeNull();
    expect(requireFinanceRead(ctxWith(['finance.read']), 'overview')).toBeNull();
    expect(requireFinanceRead(ctxWith(['finance.overview']), 'read')).toMatchObject({ error: { type: 'forbidden', permission: 'finance.read' } });
    expect(requireFinanceRead(ctxWith(['finance.setup']), 'overview')).toMatchObject({ error: { type: 'forbidden', permission: 'finance.overview' } });
  });
});
