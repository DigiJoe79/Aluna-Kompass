import { newId } from '@kompass/core';
import { contactRoles, contacts } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { financeAnnualAccountsNotes, financeCategories, financeContactTaxDetails, financeFiscalYears, financeNameConsents, financeReports } from '../src/schema';
import { setupFinance } from './helpers';

/**
 * Der mechanische Wächter des Schemas der Jahresrechnung (J1 Task 1): jede Spalte gegen die echte Datenbank, roh über
 * Drizzle — Muster `confirmation-runs-schema.test.ts`.
 */
const AT = '2027-02-01T09:00:00.000Z';

describe('Schema der Jahresrechnung', () => {
  it('kennt das Plattform-Merkmal an der Kategorie (leer als Vorgabe)', () => {
    const { deps } = setupFinance();
    const id = newId();
    deps.db.insert(financeCategories).values({ id, key: 'x-platform', name: 'X', direction: 'income', incomeKind: 'bodyGrant', donationPlatform: 'confirmsItself', createdAt: AT, updatedAt: AT }).run();
    expect(deps.db.select().from(financeCategories).where(eq(financeCategories.id, id)).get()?.donationPlatform).toBe('confirmsItself');
    const other = newId();
    deps.db.insert(financeCategories).values({ id: other, key: 'x-plain', name: 'Y', direction: 'income', createdAt: AT, updatedAt: AT }).run();
    expect(deps.db.select().from(financeCategories).where(eq(financeCategories.id, other)).get()?.donationPlatform).toBeNull();
  });

  it('kennt „juristische Person“ an den Finanzangaben zum Kontakt (null = unbekannt)', () => {
    const { deps } = setupFinance();
    const id = newId();
    deps.db.insert(financeContactTaxDetails).values({ id, contactId: 'C1', legalEntity: 'yes', updatedAt: AT, updatedByUserId: 'U1' }).run();
    expect(deps.db.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.id, id)).get()?.legalEntity).toBe('yes');
    const other = newId();
    deps.db.insert(financeContactTaxDetails).values({ id: other, contactId: 'C2', updatedAt: AT, updatedByUserId: 'U1' }).run();
    expect(deps.db.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.id, other)).get()?.legalEntity).toBeNull();
  });

  it('führt die Einwilligung zur Namensnennung als Verlauf: nur anhängen', () => {
    const { deps } = setupFinance();
    const id = newId();
    deps.db.insert(financeNameConsents).values({ id, contactId: 'C1', kind: 'granted', on: '2027-01-12', fromYear: 2026, documentId: null, createdAt: AT, createdByUserId: 'U1' }).run();
    expect(deps.db.select().from(financeNameConsents).where(eq(financeNameConsents.id, id)).get()).toEqual({
      id, contactId: 'C1', kind: 'granted', on: '2027-01-12', fromYear: 2026, documentId: null, createdAt: AT, createdByUserId: 'U1',
    });
    expect(() => deps.db.update(financeNameConsents).set({ fromYear: 2025 }).where(eq(financeNameConsents.id, id)).run()).toThrow(/permanent/);
  });

  it('löscht eine Einwilligung nur, wenn der Kontakt schon fort ist (Löschweg der Kontakte)', () => {
    const { deps } = setupFinance();
    const contactId = newId();
    deps.db.insert(contacts).values({ id: contactId, kind: 'person', firstName: 'Erika', lastName: 'Beispiel', createdAt: AT, updatedAt: AT }).run();
    const id = newId();
    deps.db.insert(financeNameConsents).values({ id, contactId, kind: 'granted', on: '2027-01-12', fromYear: 2026, createdAt: AT, createdByUserId: 'U1' }).run();
    expect(() => deps.db.delete(financeNameConsents).where(eq(financeNameConsents.id, id)).run()).toThrow(/permanent/);
    deps.db.delete(contacts).where(eq(contacts.id, contactId)).run();
    deps.db.delete(financeNameConsents).where(eq(financeNameConsents.id, id)).run();
    expect(deps.db.select().from(financeNameConsents).all()).toEqual([]);
  });

  it('hält die Erläuterung je Geschäftsjahr', () => {
    const { deps } = setupFinance();
    const yearId = newId();
    deps.db.insert(financeFiscalYears).values({ id: yearId, designation: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', createdAt: AT, updatedAt: AT }).run();
    deps.db.insert(financeAnnualAccountsNotes).values({ fiscalYearId: yearId, text: 'Ein **Jahr**.', updatedAt: AT, updatedByUserId: 'U1' }).run();
    expect(deps.db.select().from(financeAnnualAccountsNotes).where(eq(financeAnnualAccountsNotes.fiscalYearId, yearId)).get()).toEqual({ fiscalYearId: yearId, text: 'Ein **Jahr**.', updatedAt: AT, updatedByUserId: 'U1' });
  });

  it('setzt „vertritt nach § 26 BGB“ an der Rolle ohne Angabe auf nein', () => {
    const { deps } = setupFinance();
    const contactId = newId();
    deps.db.insert(contacts).values({ id: contactId, kind: 'person', firstName: 'Erika', lastName: 'Beispiel', createdAt: AT, updatedAt: AT }).run();
    const roleId = newId();
    deps.db.insert(contactRoles).values({ id: roleId, contactId, role: 'board-member', since: '2026-01-01' }).run();
    expect(deps.db.select().from(contactRoles).where(eq(contactRoles.id, roleId)).get()?.representsAssociation).toBe(false);
  });

  it('hält die Bestätigung beim Festschreiben an der Fassung, unveränderlich', () => {
    const { deps } = setupFinance();
    const yearId = newId();
    deps.db.insert(financeFiscalYears).values({ id: yearId, designation: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', createdAt: AT, updatedAt: AT }).run();
    const id = newId();
    const confirmation = JSON.stringify({ code: 'annualAccountsRemunerationWithoutBasis', reason: 'other', note: 'Rückzahlung vereinbart' });
    deps.db.insert(financeReports).values({ id, reportKey: 'annualAccounts', params: '{}', fiscalYearId: yearId, dataHash: 'h', documentId: 'D', documentNumber: 'N', finalizedAt: AT, finalizedByUserId: 'U1', finalizeConfirmation: confirmation }).run();
    expect(deps.db.select().from(financeReports).where(eq(financeReports.id, id)).get()?.finalizeConfirmation).toBe(confirmation);
    expect(() => deps.db.update(financeReports).set({ finalizeConfirmation: null }).where(eq(financeReports.id, id)).run()).toThrow(/immutable/);
  });
});
