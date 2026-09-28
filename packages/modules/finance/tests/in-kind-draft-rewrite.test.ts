import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveInKindDetails } from '../src/donations/in-kind';
import { saveDraft } from '../src/ledger/entries';
import { financeInKindDetails } from '../src/schema';
import { donationFixture } from './donation-fixture';

const details = { item: 'Transportbox aus Kunststoff', condition: 'gebraucht, guter Zustand', valuation: 'Kaufpreis laut Rechnung, abzüglich Gebrauch', origin: 'private' as const };

/**
 * Nachzügler (Design-Nachtrag Phase 4, Task 6b): Ein Entwurf mit einer
 * Sachspende-Zeile, an der schon Angaben hängen, lässt sich weiter sichern —
 * `writeLinesInternal` schreibt die Zeilen neu, die Angaben wandern mit.
 */
describe('saveDraft an einem Entwurf mit Angaben zur Sachspende', () => {
  it('sichert erneut, ohne am Fremdschlüssel zu scheitern, und die Angaben hängen an der neuen Zeile derselben Stelle', async () => {
    const f = await donationFixture();
    const lines = (cents: number) => [
      { categoryId: f.categoryByKey('in-kind-donations').id, amountCents: cents, contactId: f.erika.id },
      { categoryId: f.categoryByKey('program-in-kind').id, amountCents: -cents },
    ];
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-07', text: 'Sachspende', moneyLines: [], allocationLines: lines(25000) }));
    const inKindLine = draft.allocationLines.find((l) => l.amountCents > 0)!;
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: inKindLine.id, ...details }));

    const saved = await saveDraft(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.updatedAt, entryDate: '2026-03-07', text: 'Sachspende, Wert korrigiert', moneyLines: [], allocationLines: lines(26000) });
    expect(saved.ok).toBe(true);
    const newLine = unwrap(saved).allocationLines.find((l) => l.amountCents > 0)!;
    expect(f.deps.db.select().from(financeInKindDetails).where(eq(financeInKindDetails.lineId, newLine.id)).get()).toMatchObject({ item: details.item });
  });
});
