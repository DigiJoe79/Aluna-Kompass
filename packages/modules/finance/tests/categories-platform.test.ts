import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createCategory, updateCategory } from '../src/ledger/categories';
import { setupFinance } from './helpers';

const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));
const income = { name: 'Plattform', direction: 'income', sphere: 'ideal' } as const;

describe('Spendenplattform an der Einnahmenkategorie (J1 Task 4)', () => {
  it('„bestätigt selbst“ nur bei Zuwendung einer Körperschaft, „wickelt nur ab“ nur bei Spende', async () => {
    const { deps, ctx } = setupFinance();
    expect(fields(await createCategory(deps, ctx, { ...income, key: 'a', incomeKind: 'donation', donationPlatform: 'confirmsItself' }))).toEqual(['donationPlatform:donationPlatformKindMismatch']);
    expect(fields(await createCategory(deps, ctx, { ...income, key: 'b', incomeKind: 'bodyGrant', donationPlatform: 'handlesOnly' }))).toEqual(['donationPlatform:donationPlatformKindMismatch']);
    expect(unwrap(await createCategory(deps, ctx, { ...income, key: 'c', incomeKind: 'bodyGrant', donationPlatform: 'confirmsItself' })).donationPlatform).toBe('confirmsItself');
    expect(unwrap(await createCategory(deps, ctx, { ...income, key: 'd', incomeKind: 'donation', donationPlatform: 'handlesOnly' })).donationPlatform).toBe('handlesOnly');
    expect(unwrap(await createCategory(deps, ctx, { ...income, key: 'e', incomeKind: 'donation' })).donationPlatform).toBeNull();
  });

  it('nie an einer Ausgabe', async () => {
    const { deps, ctx } = setupFinance();
    expect(fields(await createCategory(deps, ctx, { key: 'x', name: 'X', direction: 'expense', sphere: 'ideal', costFunction: 'administration', donationPlatform: 'confirmsItself' }))).toEqual(['donationPlatform:donationPlatformKindMismatch']);
  });

  it('lässt sich ändern und wieder leeren', async () => {
    const { deps, ctx } = setupFinance();
    const cat = unwrap(await createCategory(deps, ctx, { ...income, key: 'c', incomeKind: 'bodyGrant' }));
    const set = unwrap(await updateCategory(deps, ctx, { id: cat.id, donationPlatform: 'confirmsItself' }));
    expect(set.donationPlatform).toBe('confirmsItself');
    expect(fields(await updateCategory(deps, ctx, { id: cat.id, incomeKind: 'donation' }))).toEqual(['donationPlatform:donationPlatformKindMismatch']);
    expect(unwrap(await updateCategory(deps, ctx, { id: cat.id, donationPlatform: null })).donationPlatform).toBeNull();
  });
});
