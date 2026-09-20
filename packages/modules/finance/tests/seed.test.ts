import { schema, unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { contactRoles } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { installFinance } from '../src/install';
import { listAccounts } from '../src/ledger/accounts';
import { listCategories } from '../src/ledger/categories';
import { getEntry } from '../src/ledger/entries';
import { listFiscalYears } from '../src/ledger/fiscal-years';
import { listPurposes } from '../src/ledger/purposes';
import { financeEntries } from '../src/schema';
import { seedFinance } from '../src/seed';
import { setupFinance } from './helpers';

describe('seedFinance', () => {
  it('builds an invented association year and is idempotent', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);
    const accounts = unwrap(await listAccounts(deps, ctx, { includeInactive: true }));
    expect(accounts.map((a) => a.kind).sort()).toEqual(['bank', 'bank', 'cash', 'paymentService']);
    expect(accounts.filter((a) => a.isMain)).toHaveLength(1);
    expect(accounts.some((a) => !a.isActive)).toBe(true);
    expect(unwrap(await listFiscalYears(deps, ctx))).toHaveLength(2);
    const purposes = unwrap(await listPurposes(deps, ctx, { includeInactive: true }));
    expect(purposes).toHaveLength(4);
    expect(purposes.some((p) => p.abroad) && purposes.some((p) => p.fulfilledAt !== null)).toBe(true);
    expect(unwrap(await listCategories(deps, ctx, {})).map((c) => c.key)).toContain('room-rental');
  });

  it('uses no animal and no association-specific wording', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const all = JSON.stringify([unwrap(await listAccounts(deps, ctx, { includeInactive: true })), unwrap(await listPurposes(deps, ctx, { includeInactive: true }))]);
    expect(all).not.toMatch(/tier|hund|katze|aluna|futter/i);
  });

  it('leaves no name, no IBAN and no free text in the audit log — the log cannot be deleted', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    const log = JSON.stringify(deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.')));
    expect(log.length).toBeGreaterThan(100);
    for (const secret of [
      'Vereinskonto', 'Barkasse', 'Spendenplattform', 'Sparbuch', 'Beispielbank', 'DE0212', 'AT6119', 'Dachsanierung', 'Jugendfreizeit', 'Flutlicht', 'Erika', 'Beispiel über', 'Raumvermietung',
      'Spende Altjahr', 'Bankgebühr Altjahr', 'Büromaterial Altjahr', 'Spende mit Zweck', 'Auszahlung Spendenplattform', 'Abhebung Barkasse', 'Bar-Ausgabe Fahrtkosten', 'Sachspende Werkzeug', 'Fehlerhafte Spendenbuchung', 'Entwurf geprüft', 'Entwurf ungeprüft', 'Entwurf vom Agenten',
      'Wagner', 'Kruse',
    ]) {
      expect(log, secret).not.toContain(secret);
    }
  });

  it('books an entry in every state of a booking year, and is idempotent', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const entries = deps.db.select().from(financeEntries).all();
    const byText = new Map(entries.map((e) => [e.text, e]));

    // Vorjahr: drei festgeschriebene Buchungen — kein Duplikat beim zweiten Lauf.
    for (const text of ['Spende Altjahr', 'Bankgebühr Altjahr', 'Büromaterial Altjahr']) {
      expect(entries.filter((e) => e.text === text), text).toHaveLength(1);
      expect(byText.get(text), text).toMatchObject({ status: 'final' });
    }

    // Laufendes Jahr: Split, Umbuchung, Barausgabe, Sachspende — alle festgeschrieben.
    for (const text of ['Spende mit Zweck', 'Auszahlung Spendenplattform', 'Abhebung Barkasse', 'Bar-Ausgabe Fahrtkosten', 'Sachspende Werkzeug']) {
      expect(byText.get(text), text).toMatchObject({ status: 'final' });
    }

    // Eine stornierte Buchung mit ihrem Storno.
    const original = byText.get('Fehlerhafte Spendenbuchung')!;
    expect(original).toMatchObject({ status: 'final' });
    expect(original.reversedByEntryId).not.toBeNull();
    const reversal = entries.find((e) => e.id === original.reversedByEntryId);
    expect(reversal).toMatchObject({ status: 'final', reversesEntryId: original.id });

    // Ein geprüfter, ein ungeprüfter, ein Entwurf vom Agenten — einer davon unausgeglichen.
    expect(byText.get('Entwurf geprüft')).toMatchObject({ status: 'draft' });
    expect(byText.get('Entwurf geprüft')!.reviewedAt).not.toBeNull();
    expect(byText.get('Entwurf ungeprüft')).toMatchObject({ status: 'draft', reviewedAt: null });
    const agentDraft = byText.get('Entwurf vom Agenten')!;
    expect(agentDraft).toMatchObject({ status: 'draft', createdChannel: 'mcp' });
    expect(unwrap(await getEntry(deps, ctx, { id: agentDraft.id })).remainderCents).not.toBe(0);

    // Zwei erfundene Spender-Kontakte mit Rolle donor.
    const donors = deps.db.select().from(contactRoles).where(eq(contactRoles.role, 'donor')).all();
    expect(donors.length).toBeGreaterThanOrEqual(2);
  });
});
