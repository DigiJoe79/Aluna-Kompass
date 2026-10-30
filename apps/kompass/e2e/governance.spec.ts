import { associationDay } from './association-day';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';
import { STORY_YEAR } from './story-year';

/**
 * Gremien (Plan U1): genau die Abläufe mit Schaden der Stufe Ablauf — eine Sitzung von der Anlage bis zum Ende des
 * Mitlaufs (Fall 1), das Festschreiben nach dem Ablegen des unterschriebenen Protokolls (Fall 2) und die Erlaubnis für
 * Agenten auf der Seite Verwaltung → Agenten (Fall 3, Spec 2026-10-29).
 */
test.describe('governance', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Fall 1: Sitzung anlegen, beginnen, im Mitlauf einstimmig beschließen, beenden', async ({ page }) => {
    await page.goto('/governance/meetings/new');
    await page.getByLabel('Art').selectOption('extraordinary');
    await page.getByLabel('Datum').fill(associationDay());
    // Beginn um Mitternacht: Das Ende des Mitlaufs ist „jetzt“ und darf nicht vor dem Beginn liegen.
    await page.getByLabel('Uhrzeit').fill('00:00');
    await page.getByTestId('meeting-create-save').click();
    await expect(page).toHaveURL(/\/governance\/meetings\/[0-9A-Z]{26}$/);

    for (const [title, kind] of [['Begrüßung', 'report'], ['Anschaffung Zelt', 'simple'], ['Verschiedenes', 'other']] as const) {
      await page.getByTestId('agenda-create').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('agenda-item-title').fill(title);
      await dialog.getByTestId('agenda-item-kind').selectOption(kind);
      await dialog.getByTestId('agenda-item-save').click();
      await expect(dialog).toBeHidden();
    }
    await expect(page.getByTestId('agenda-row')).toHaveCount(3);

    await page.getByTestId('meeting-start').click();
    await expect(page).toHaveURL(/\/live$/);
    // Drei Personen kommen; Fördermitglieder zählen nicht als stimmberechtigt.
    const toggles = page.getByTestId('attendance-panel').first().getByTestId('attendance-toggle');
    for (let i = 0; i < 3; i++) await toggles.nth(i).click();
    await expect(page.getByTestId('strip-attendance')).not.toContainText(/^0 /);

    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.getByTestId('item-panel')).toContainText('Anschaffung Zelt');
    await page.keyboard.press('e');
    await expect(page.getByTestId('live-next')).toBeFocused();
    // Gespeichert, nicht nur im Browser: die Lageleiste meldet den Zwischenstand und nichts wartet mehr.
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-pending', 'false', { timeout: 30_000 });
    await expect(page.getByTestId('save-status')).toContainText('Zwischenstand gespeichert');

    await page.getByTestId('strip-end').click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Mitlauf beenden' }).click();
    await expect(page).toHaveURL(/\/governance\/meetings\/[0-9A-Z]{26}$/);
    await expect(page.getByTestId('meeting-steps-minutes')).toHaveAttribute('data-state', 'active');
    await page.reload();
    await expect(page.getByTestId('meeting-head')).toBeVisible();
    await expect(page.locator('[data-slot="status-badge"]').first()).toHaveText('protokolliert');
    // Der Entwurf kommt aus dem gespeicherten Stand, nicht aus dem Browser.
    const draft = await page.request.get((await page.getByTestId('minutes-draft').getAttribute('href'))!);
    expect(draft.ok()).toBe(true);
    expect(draft.headers()['content-type']).toContain('application/pdf');
  });

  test('Fall 2: unterschriebenes Protokoll ablegen und festschreiben', async ({ page }) => {
    // Die Übersicht liest Regelwerk, Ämter und alle Fristen; sie muss stehen, bevor es weitergeht.
    await page.goto('/governance');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/governance/meetings');
    await page.getByTestId('meetings-filters').getByLabel('Zustand').selectOption('recorded');
    await expect(page).toHaveURL(/state=recorded/);
    await page.getByRole('link', { name: new RegExp(`10\\.06\\.${STORY_YEAR}`) }).click();
    await expect(page.getByTestId('meeting-steps-minutes')).toHaveAttribute('data-state', 'active');
    await page.getByTestId('minutes-drop').locator('input[type="file"]').setInputFiles('e2e/fixtures/brief-digital.pdf');
    await expect(page.getByTestId('requirement-signed')).toHaveAttribute('data-done', 'true');
    await page.getByTestId('meeting-seal').click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page.locator('[data-slot="status-badge"]').first()).toHaveText('festgeschrieben');
    await expect(page.getByTestId('meeting-steps')).toContainText('Fertig.');
    await page.reload();
    await expect(page.locator('[data-slot="status-badge"]').first()).toHaveText('festgeschrieben');
  });

  test('Fall 3: Verwaltung → Agenten — Schalter Gremien an, nach dem Neuladen an', async ({ page }) => {
    await page.goto('/admin/agents');
    const card = page.getByTestId('agent-switches');
    const question = 'Darf ein Agent einladen, festschreiben und Satzungsstände eintragen?';
    await expect(card.getByRole('switch', { name: question })).not.toBeChecked();
    await card.getByRole('switch', { name: question }).click();
    await card.getByTestId('agent-switches-save').click();
    await expect(page.getByText('Schalter für Agenten gespeichert.')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('agent-switches').getByRole('switch', { name: question })).toBeChecked();
  });
});
