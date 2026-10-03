import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test('das alte Lesezeichen führt auf den Template-Reiter der Einstellungen', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await expect(page).toHaveURL('/admin/site?panel=template');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Webseite');
  const tabs = page.getByRole('navigation', { name: 'Bereiche der Webseite' });
  await expect(tabs.getByRole('link')).toHaveText(['Template', 'Verbindung', 'Cache', 'Gesperrte Begriffe']);
  await expect(tabs.getByRole('link', { name: 'Template' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');
  const nav = page.getByRole('navigation', { name: 'Unternavigation' });
  await expect(nav.getByRole('link', { name: 'Webseite', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('Verbindung testen unter Einstellungen → Webseite räumt nichts am Ziel', async ({ page }) => {
  test.setTimeout(60_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  const fs = await import('node:fs');
  const path = await import('node:path');
  const target = process.env.E2E_SITE_TARGET!;
  fs.mkdirSync(target, { recursive: true });
  const stranger = path.join(target, 'altlast.html');
  fs.writeFileSync(stranger, '<html>Fremd</html>');
  try {
    await page.goto('/admin/site?panel=connection');
    await expect(page.getByText('lokales Verzeichnis')).toBeVisible();
    await page.getByRole('button', { name: 'Verbindung testen' }).click();
    const result = page.getByRole('region', { name: 'Verbindungstest' });
    await expect(result.getByRole('list', { name: 'Prüfpunkte' })).toContainText('Zielverzeichnis: in Ordnung', { timeout: 30_000 });
    await expect(result).toContainText('Verbindung steht');
    await result.getByText('Am Ziel gefunden').click();
    await expect(result).toContainText('altlast.html');
    // Die Probedatei bleibt nicht liegen.
    expect(fs.readdirSync(target).filter((n) => n.startsWith('.kompass-probe'))).toEqual([]);
    expect(fs.readFileSync(stranger, 'utf8')).toBe('<html>Fremd</html>');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Verbindungstest' })).toContainText('Zuletzt getestet');
  } finally {
    // Das Ziel überlebt resetDatabase; spätere Tests im selben Worker sollen es leer vorfinden.
    fs.rmSync(stranger, { force: true });
  }
});

test('Cache leeren unter Einstellungen → Webseite', async ({ page }) => {
  test.setTimeout(180_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/site?panel=template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');
  // Die Vorschau füllt die Bildvarianten.
  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  // Während der Lauf läuft, ist der Knopf gesperrt (ist er schneller fertig als die Abfrage, entfällt die Prüfung).
  const running = async () => ((await (await page.request.get('/site/job')).json()) as { running: unknown }).running !== null;
  let busy = false;
  for (let i = 0; i < 100 && !busy; i++) {
    busy = await running();
    if (!busy) await page.waitForTimeout(50);
  }
  if (busy) {
    await page.goto('/admin/site?panel=cache');
    await expect(page.getByRole('button', { name: 'Cache leeren' })).toBeDisabled();
  }
  await expect.poll(running, { timeout: 120_000 }).toBe(false);
  await page.goto('/admin/site?panel=cache');
  await expect(page.getByText(/[1-9]\d* Bildvarianten/)).toBeVisible();
  await page.getByRole('button', { name: 'Cache leeren' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cache leeren' }).click();
  await expect(page.getByRole('status')).toContainText('gelöscht');
  await expect(page.getByText('0 Bildvarianten')).toBeVisible();
});
