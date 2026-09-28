import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { personYearOverview } from '../src/allocation/people';
import { bookEntry } from '../src/ledger/finalize';
import { financeCategories } from '../src/schema';
import { expenseFixture, type ExpenseFixture } from './expense-fixture';

const volunteer = (f: ExpenseFixture) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'volunteer-allowance')).get()!;
const pay = (f: ExpenseFixture, cents: number, entryDate: string) =>
  bookEntry(f.deps, f.ctx, { entryDate, text: 'Ehrenamtspauschale', moneyLines: [{ accountId: f.bank.id, amountCents: -cents }], allocationLines: [{ categoryId: volunteer(f).id, amountCents: -cents, contactId: f.hanna.contactId }] });

describe('allowance above the yearly cap (AI)', () => {
  it('the overview flags 800 € + 200 € against 960 € as exceeded by 40 €, per person and allowance', async () => {
    const f = await expenseFixture();
    unwrap(await pay(f, 80000, '2026-03-01'));
    const before = unwrap(await personYearOverview(f.deps, f.ctx, { year: 2026 })).rows.find((r) => r.contactId === f.hanna.contactId)!;
    expect(before).toMatchObject({ allowanceVolunteerExceeded: false, allowanceVolunteerOverCents: 0, allowanceTrainerExceeded: false, allowanceTrainerOverCents: 0 });
    unwrap(await pay(f, 20000, '2026-06-01'));
    const after = unwrap(await personYearOverview(f.deps, f.ctx, { year: 2026 })).rows.find((r) => r.contactId === f.hanna.contactId)!;
    expect(after).toMatchObject({ allowanceVolunteerCents: 100000, allowanceVolunteerExceeded: true, allowanceVolunteerOverCents: 4000 });
  });

  it('booking the line that crosses the cap returns a warning with person, amount above, allowance and year — no reason needed', async () => {
    const f = await expenseFixture();
    const first = unwrap(await pay(f, 80000, '2026-03-01'));
    expect(first.notices).not.toContain('allowanceExceeded');
    const second = unwrap(await pay(f, 20000, '2026-06-01'));
    expect(second.notices).toContain('allowanceExceeded');
    expect(second.allowanceExceeded).toEqual([{ contactId: f.hanna.contactId, contactName: 'Hanna Helferin', kind: 'volunteer', year: 2026, overCents: 4000 }]);
  });
});
