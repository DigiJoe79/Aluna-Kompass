import { getEffectivePermissions, schema, unwrap } from '@kompass/core';
import { insertUser, systemContext } from '@kompass/core/testing';
import { contactRoles } from '@kompass/module-contacts';
import { projects } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { installFinance } from '../src/install';
import { listAccounts } from '../src/ledger/accounts';
import { listCategories } from '../src/ledger/categories';
import { listAllocationCorrections } from '../src/ledger/corrections';
import { getEntry } from '../src/ledger/entries';
import { listFiscalYears } from '../src/ledger/fiscal-years';
import { listOpenItems } from '../src/ledger/open-items';
import { getBalances } from '../src/ledger/overview';
import { getProjectFinance } from '../src/ledger/project-settings';
import { listPurposes } from '../src/ledger/purposes';
import { financeEntries, financeEntryDocuments } from '../src/schema';
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
    expect(purposes).toHaveLength(5);
    expect(purposes.some((p) => p.abroad) && purposes.some((p) => p.fulfilledAt !== null)).toBe(true);
    expect(unwrap(await listCategories(deps, ctx, {})).map((c) => c.key)).toContain('room-rental');
  });

  it('closes the previous fiscal year — a booking without a voucher is justified, not blocking', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);
    const years = unwrap(await listFiscalYears(deps, ctx));
    const previous = years.find((y) => y.designation !== years.reduce((a, b) => (a.designation > b.designation ? a : b)).designation)!;
    expect(previous.status).toBe('closed');
  });

  it('flags a purpose in the red and a purpose fulfilled with rest', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const balances = unwrap(await getBalances(deps, ctx, {}));
    const sommerfest = balances.purposes.find((p) => p.negative);
    expect(sommerfest).toBeTruthy();
    const floodlight = balances.purposes.find((p) => p.fulfilledWithRest);
    expect(floodlight).toBeTruthy();
  });

  it('gives an existing project finance fields', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const existingProject = deps.db.select({ id: projects.id }).from(projects).limit(1).get();
    if (!existingProject) return; // Kein Projekte-Seed installiert — nichts zu prüfen.
    const read = unwrap(await getProjectFinance(deps, ctx, { projectId: existingProject.id }));
    expect(read.settings.targetCents).toBe(250000);
    expect(read.settings.defaultPurposeId).not.toBeNull();
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
      'Spende Altjahr', 'Bankgebühr Altjahr', 'Büromaterial Altjahr', 'Spende mit Zweck', 'Auszahlung Spendenplattform', 'Abhebung Barkasse', 'Bar-Ausgabe Fahrtkosten', 'Sachspende Werkzeug', 'Fehlerhafte Spendenbuchung', 'Entwurf geprüft', 'Entwurf ungeprüft', 'Entwurf ungeprüft zwei', 'Entwurf vom Agenten',
      'Wagner', 'Kruse',
      // F2b: Belege, offene Posten, Zuordnungskorrektur.
      'Rechnung Büromaterial', 'Falscher Anhang hochgeladen, richtige Quittung liegt vor',
      'RE-2026-041', 'RE-2026-055', 'SP-2026-003', 'RE-2026-060', 'Doppelt erfasst, storniert vor Zahlung',
      'Teilzahlung Lieferant', 'Ausgleich Forderung',
      'Auslandsbezug bei der Erfassung übersehen', 'Spenderin nachträglich zugeordnet',
      // F2c: Begründung zum Periodenabschluss, neue Buchungstexte und Zwecke.
      'Kleinbetrag bar erhalten, kein Beleg ausgestellt',
      'Spende Flutlicht', 'Ausgabe Sommerfest', 'Sommerfest',
    ]) {
      expect(log, secret).not.toContain(secret);
    }
  });

  it('files a voucher on three entries, revokes and replaces one, and leaves one deliberately without', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const byText = (text: string) => deps.db.select().from(financeEntries).where(eq(financeEntries.text, text)).get()!;
    const linksFor = (entryId: string) => deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, entryId)).all();

    expect(linksFor(byText('Büromaterial Altjahr').id)).toHaveLength(1);
    expect(linksFor(byText('Bar-Ausgabe Fahrtkosten').id)).toHaveLength(1);
    const bankgebuehrLinks = linksFor(byText('Bankgebühr Altjahr').id);
    expect(bankgebuehrLinks).toHaveLength(2);
    expect(bankgebuehrLinks.some((l) => l.revokedAt !== null && l.replacedByLinkId !== null)).toBe(true);
    expect(linksFor(byText('Spende Altjahr').id)).toHaveLength(0);
  });

  it('seeds open items in every state: open, partially paid, settled, and cancelled without payment', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const items = unwrap(await listOpenItems(deps, ctx, { state: 'all' })).items;
    const byRef = new Map(items.map((i) => [i.paymentReference, i]));
    expect(byRef.get('RE-2026-041')).toMatchObject({ state: 'open', settledCents: 0 });
    expect(byRef.get('RE-2026-055')?.state).toBe('open');
    expect(byRef.get('RE-2026-055')?.settledCents).toBeGreaterThan(0);
    expect(byRef.get('SP-2026-003')).toMatchObject({ state: 'settled' });
    expect(byRef.get('RE-2026-060')).toMatchObject({ state: 'cancelled' });
  });

  it('seeds an applied correction in the running year and a pending one in the closed previous year, and is idempotent', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const corrections = unwrap(await listAllocationCorrections(deps, ctx, {})).items;
    expect(corrections.filter((c) => c.state === 'applied').length).toBe(1);
    expect(corrections.filter((c) => c.state === 'pending').length).toBe(1);
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
    // F3a: ein zweiter ausgeglichener, ungeprüfter Entwurf — die Mehrfachauswahl des Journals braucht zwei.
    expect(byText.get('Entwurf ungeprüft zwei')).toMatchObject({ status: 'draft', reviewedAt: null });
    const secondDraft = byText.get('Entwurf ungeprüft zwei')!;
    expect(unwrap(await getEntry(deps, ctx, { id: secondDraft.id })).remainderCents).toBe(0);
    const agentDraft = byText.get('Entwurf vom Agenten')!;
    expect(agentDraft).toMatchObject({ status: 'draft', createdChannel: 'mcp' });
    expect(unwrap(await getEntry(deps, ctx, { id: agentDraft.id })).remainderCents).not.toBe(0);

    // Zwei erfundene Spender-Kontakte mit Rolle donor.
    const donors = deps.db.select().from(contactRoles).where(eq(contactRoles.role, 'donor')).all();
    expect(donors.length).toBeGreaterThanOrEqual(2);
  });

  it('gives an existing „Mira Klein“ (Kernseed) finance.read without finance.entriesFinalize — for the missing „Korrigieren“ button', async () => {
    const { deps, ctx } = setupFinance();
    insertUser(deps, { name: 'Mira Klein', email: 'mira@kompass.local' });
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const mira = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'mira@kompass.local')).get()!;
    const permissions = getEffectivePermissions(deps.db, deps.registry, mira.id);
    expect(permissions.has('finance.read')).toBe(true);
    expect(permissions.has('finance.entriesFinalize')).toBe(false);
  });
});
