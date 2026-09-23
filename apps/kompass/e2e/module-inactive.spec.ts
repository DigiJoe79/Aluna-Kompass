import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

/**
 * Befund N4 (Befundliste 0.2.0): Ein ausgeschaltetes Modul sperrt seine Seiten
 * und Dateiwege — bisher taten das nur Tiere und Finanzen. Geschaltet wird die
 * Einstellung `modules.enabled` direkt (wie in finance.spec.ts): Finanzen hält
 * im Seed Kontakte, Belege und Projekte, die Dienste ließen das Ausschalten gar
 * nicht zu. Geprüft wird hier, dass die Seiten das Fehlen des Schlüssels
 * befolgen, nicht der Dienst `setModuleEnabled`.
 */
const ALL = ['animals', 'contacts', 'dms', 'projects', 'site'];
const without = (key: string) => ALL.filter((k) => k !== key);

test.describe('Modul inaktiv', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  const cases = [
    { key: 'dms', title: 'Modul Dokumentenmanagement ist nicht aktiv', paths: ['/dms', '/dms/new', '/dms/receive', '/admin/dms'] },
    { key: 'contacts', title: 'Modul Kontakte ist nicht aktiv', paths: ['/contacts'] },
    { key: 'projects', title: 'Modul Projekte ist nicht aktiv', paths: ['/projects'] },
  ];

  for (const c of cases) {
    test(`ohne ${c.key} zeigen dessen Seiten die Sperre und den Weg zu den Modulen`, async ({ page }) => {
      await setE2ESetting(page, 'modules.enabled', without(c.key));
      for (const p of c.paths) {
        await page.goto(p);
        await expect(page.getByRole('heading', { name: c.title })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Module öffnen' })).toBeVisible();
      }
    });
  }

  test('eine Detailseite ist ebenfalls gesperrt', async ({ page }) => {
    await page.goto('/contacts');
    const detail = await page.locator('a[href^="/contacts/"]').first().getAttribute('href');
    expect(detail).toMatch(/^\/contacts\/[0-9A-Z]{26}$/);
    await setE2ESetting(page, 'modules.enabled', without('contacts'));
    await page.goto(detail!);
    await expect(page.getByRole('heading', { name: 'Modul Kontakte ist nicht aktiv' })).toBeVisible();
  });

  test('Datei, Vorschau und Export der Akte antworten ohne dms mit 404', async ({ page }) => {
    await page.goto('/dms');
    await page.getByRole('row').filter({ hasText: 'Freistellungsbescheid' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    const id = page.url().split('/').pop()!;
    // Vorher erreichbar — sonst bewiese das 404 danach nichts.
    expect((await page.request.get(`/dms/${id}/file`)).status()).toBe(200);
    expect((await page.request.get(`/dms/${id}/preview`)).status()).toBe(200);
    expect((await page.request.post('/dms/export', { data: {} })).status()).not.toBe(404);

    await setE2ESetting(page, 'modules.enabled', without('dms'));
    expect((await page.request.get(`/dms/${id}/file`)).status()).toBe(404);
    expect((await page.request.get(`/dms/${id}/preview`)).status()).toBe(404);
    expect((await page.request.post('/dms/export', { data: {} })).status()).toBe(404);
  });

  test('bei eingeschaltetem Modul bleibt alles erreichbar', async ({ page }) => {
    for (const p of ['/dms', '/contacts', '/projects', '/admin/dms']) {
      await page.goto(p);
      await expect(page.getByRole('heading', { name: /ist nicht aktiv/ })).toHaveCount(0);
    }
  });
});
