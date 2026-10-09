import type { Client } from '@modelcontextprotocol/client';
import { expect, test } from './fixtures';
import { associationDay } from './association-day';
import { backToAdmin, callTool, linkOwnContact, mcpClient, submitClaim, switchToJonas } from './expense-helpers';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

const year = () => associationDay().slice(0, 4);

async function bank(client: Client): Promise<{ id: string }> {
  return (await callTool<{ id: string; isMain?: boolean }[]>(client, 'finance_master_data', { kind: 'account' })).find((a) => a.isMain) as { id: string };
}
async function category(client: Client, key: string): Promise<{ id: string }> {
  return (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === key)!;
}

/**
 * F8b Task 6b — Finanzen → Personen (D4, Annahme 9, 10): Karte mit
 * Zustandswort gegen die Grenze; E21 mit „freigegeben von“; Warnwort bei
 * einer Pauschale an ein Vorstandsmitglied ohne bestätigten Einrichtungspunkt
 * — und keines mehr, sobald er bestätigt ist.
 */
test.describe('finance people (F8b)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Karte mit Zustandswort, E21 mit Freigeber, Warnung ohne Einrichtungspunkt, keine nach Bestätigung', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true); // Buchen und Freigeben per Werkzeug sind humanOnly — hier nur für die Ausgangslage.
    await linkOwnContact(page); // Anna Berger ↔ Tomas Leitner: der Antrag hat dann einen Kontakt.
    const admin = await mcpClient(page, baseURL);
    const tomas = (await callTool<{ contacts: { id: string }[] }>(admin, 'contacts_list', { text: 'Leitner' })).contacts[0]!;
    await callTool(admin, 'contacts_add_role', { id: tomas.id, role: 'board-member', since: `${year()}-01-01` });

    // Pauschale an das Vorstandsmitglied: 800 € von 960 € — „nähert sich“ ab 80 %.
    const volunteer = await category(admin, 'volunteer-allowance');
    await callTool(admin, 'finance_entry_book', {
      entryDate: associationDay(),
      text: 'Ehrenamtspauschale Vorstand',
      moneyLines: [{ accountId: (await bank(admin)).id, amountCents: -80000 }],
      allocationLines: [{ categoryId: volunteer.id, amountCents: -80000, contactId: tomas.id }],
      // Befund AH: Pauschale an ein Vorstandsmitglied ohne Grundlage — nur mit Begründung.
      reason: 'Satzungsänderung beantragt',
    });

    // Eine Auslage, die Jonas Feld freigibt und die Verwaltung bezahlt — E21 nennt ihn als Freigeber.
    const claim = await submitClaim(admin, { purpose: 'Futter für die Pflegestelle', amountCents: 4500 });
    await switchToJonas(page);
    const jonas = await mcpClient(page, baseURL);
    const view = await callTool<{ id: string; version: string; positions: { id: string }[] }>(jonas, 'finance_expense_get', { id: claim.id });
    const programCosts = await category(jonas, 'program-costs');
    await callTool(jonas, 'finance_expense_approve', { claimId: view.id, expectedVersion: view.version, positions: view.positions.map((p) => ({ positionId: p.id, categoryId: programCosts.id })) });
    await backToAdmin(page);
    const admin2 = await mcpClient(page, baseURL);
    const approved = await callTool<{ openItemId: string }>(admin2, 'finance_expense_get', { id: claim.id });
    await callTool(admin2, 'finance_entry_book', {
      entryDate: associationDay(),
      text: 'Erstattung Auslage',
      moneyLines: [{ accountId: (await bank(admin2)).id, amountCents: -4500, settlements: [{ openItemId: approved.openItemId, amountCents: 4500 }] }],
      allocationLines: [{ categoryId: programCosts.id, amountCents: -4500, contactId: tomas.id }],
    });

    await page.goto('/finance/people');
    // Design-Nachtrag Phase 4 (D4): Titel mit Jahr; Geschäftsjahr = Kalenderjahr → keine zwei Zeiträume.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Personenübersicht ${year()}`);
    // Spec Filterleisten § 4: Jahr ist ein Filter der Leiste, keine Links mehr.
    await expect(page.getByTestId('people-year').getByRole('combobox', { name: 'Jahr' })).toHaveValue(String(year()));
    await expect(page.getByTestId('people-year').getByRole('link')).toHaveCount(0);
    await expect(page.getByTestId('people-allowances-heading')).toHaveText('Pauschalen und Erstattungen');
    await expect(page.getByTestId('people-related-heading')).toHaveText('Zahlungen an Vorstand und nahestehende Personen');
    const card = page.getByTestId('person-card').filter({ hasText: 'Tomas Leitner' });
    await expect(card).toContainText('Ehrenamtspauschale');
    await expect(card).toContainText('nähert sich');
    await expect(card).toContainText(`Erstattungen ${year()}: 45,00 € · 1 Antrag`);

    await expect(page.getByTestId('related-party-table').getByRole('columnheader')).toHaveText(['Datum', 'Person', 'Rolle am Kontakt', 'Art', 'Betrag', 'freigegeben von']);
    const rows = page.getByTestId('related-party-row').filter({ hasText: 'Tomas Leitner' });
    await expect(rows.filter({ hasText: '800,00 €' }).getByTestId('related-party-role')).toHaveText('Vorstand');
    await expect(rows.filter({ hasText: '800,00 €' }).getByTestId('related-party-kind')).toContainText('Ehrenamtspauschale');
    await expect(rows.filter({ hasText: '45,00 €' }).getByTestId('related-party-kind')).toContainText(/Auslage KE-\d{4}-\d+/);
    await expect(rows.filter({ hasText: '800,00 €' }).getByTestId('board-allowance-warning')).toContainText('Pauschale ohne bestätigte Grundlage');
    await expect(rows.filter({ hasText: '45,00 €' }).getByTestId('related-party-approver')).toHaveText('Jonas Feld');

    // Einrichtungspunkt bestätigt → kein Warnwort mehr.
    await callTool(admin2, 'finance_setup_board_remuneration', { allowed: true, basisText: '§ 7 Abs. 3 der Satzung', validFrom: `${year()}-01-01` });
    await page.reload();
    await expect(page.getByTestId('board-allowance-warning')).toHaveCount(0);

    // Überschritten: der Satz aus Befund AI (Entscheidung 9), wie beim Buchen.
    await callTool(admin2, 'finance_entry_book', {
      entryDate: associationDay(),
      text: 'Ehrenamtspauschale Nachzahlung',
      moneyLines: [{ accountId: (await bank(admin2)).id, amountCents: -30000 }],
      allocationLines: [{ categoryId: volunteer.id, amountCents: -30000, contactId: tomas.id }],
    });
    await page.reload();
    await expect(card).toContainText(`Tomas Leitner liegt damit 140,00 € über der Ehrenamtspauschale ${year()}. Der übersteigende Betrag ist nicht steuerfrei; ob der Verein Lohnsteuer oder Sozialversicherung abführen muss, hängt an der Art der Tätigkeit.`);
  });
});
