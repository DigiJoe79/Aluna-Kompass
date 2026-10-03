import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, waitForHydration } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const importTemplate = async (page: import('@playwright/test').Page) => {
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');
};

/** Die Karte der Publizieren-Seite: ihr Titel nennt den einen Zustand. */
const cardTitle = (page: import('@playwright/test').Page, name: string | RegExp) => page.getByRole('heading', { level: 2, name });

test('the preview blocks on a blocked term and says where to change it', async ({ page }) => {
  // Der erste Test im Worker, der das Template einliest: Die Route wird dabei zum ersten Mal übersetzt.
  test.setTimeout(180_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await importTemplate(page);

  // Die Liste liegt unter Einstellungen → Webseite; bis 0.1.1 ließ sie sich nirgends pflegen (Backlog 23).
  await page.goto('/admin/site?panel=blockedTerms');
  const terms = page.getByRole('region', { name: 'Sperrwörter' });
  await terms.getByLabel('Begriffe, einer je Zeile').fill('Popescu\nLorem ipsum');
  await terms.getByRole('button', { name: 'Sperrwörter speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Sperrwörter gespeichert');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Sperrwörter' }).getByLabel('Begriffe, einer je Zeile')).toHaveValue('Popescu\nLorem ipsum');
  await page.goto('/site/publish');
  await expect(page.getByRole('region', { name: 'Sperrwörter' })).toHaveCount(0);

  await page.goto('/site/variables');
  await page.locator('[name="claim.de"]').fill('Frau Popescu betreibt den Verein.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/site/publish');
  await expect(cardTitle(page, 'Noch keine Vorschau')).toBeVisible();
  // „Prüfen“ ist der erste Schritt der Vorschau, kein eigener Knopf.
  await expect(page.getByRole('button', { name: 'Prüfen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();

  await expect(cardTitle(page, 'Publizieren gesperrt')).toBeVisible({ timeout: 120_000 });
  const blocked = page.getByRole('region', { name: 'Publizieren gesperrt' });
  await expect(blocked).toContainText('popescu');
  await expect(blocked).toContainText('variables.claim');
  await expect(blocked.getByRole('link', { name: 'Variablen bearbeiten' })).toHaveAttribute('href', '/site/variables');
  await expect(blocked.getByRole('link', { name: 'Liste der gesperrten Begriffe' })).toHaveAttribute('href', '/admin/site?panel=blockedTerms');
  // Gesperrt, aber lesbar erklärt: fokussierbar, mit Grund.
  const locked = page.getByRole('button', { name: 'Auf Test publizieren' });
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  // Die Entwicklungsdaten tragen einen veröffentlichten Hund, dessen Prüfung
  // offen ist. Der Befund nennt ihn und führt ins Profil; er sperrt nicht.
  await page.getByText('Einzelheiten: Dateien und Hinweise').click();
  const pending = page.getByRole('region', { name: 'Noch zu prüfen' });
  await pending.getByText(/Noch zu prüfen/).click();
  await expect(pending.getByRole('link', { name: 'Mika' })).toHaveAttribute('href', /\/animals\/[A-Z0-9]+$/);
  // Keine Verbindungsprobe auf dieser Seite: Sie liegt unter Einstellungen.
  await expect(page.locator('main').getByText('Verbindung')).toHaveCount(0);

  await blocked.getByRole('link', { name: 'Liste der gesperrten Begriffe' }).click();
  await expect(page).toHaveURL('/admin/site?panel=blockedTerms');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Webseite' })).toBeVisible();
});

test('preview build, diff and publish to the local staging target', async ({ page }) => {
  test.setTimeout(240_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await importTemplate(page);

  await page.goto('/site/c/news/new');
  await page.getByLabel('Slug (URL-Teil)').fill('sommerfest');
  await page.locator('[name="title.de"]').fill('Sommerfest 2026');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page).toHaveURL('/site/c/news');
  // Der Schalter dieser einen Meldung, nicht irgendeiner: Seit die Webseite
  // Entwicklungsdaten mitbringt (`seedSiteDevelopment`), stehen weitere
  // Einträge in der Liste.
  const publish = page.getByRole('row', { name: /Sommerfest 2026/ }).getByRole('switch', { name: 'Veröffentlicht' });
  await publish.click();
  await expect(publish).toBeChecked();

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  // Während des Baus meldet /site/job, was läuft und seit wann; der Poller des
  // Tabs fragt das ab. Warm baut das Basis-Template in unter einer Sekunde,
  // deshalb fragt der Test selbst sofort nach dem Klick.
  type Job = { running: { kind: string; elapsedMs: number } | null };
  let running: Job['running'] = null;
  for (let i = 0; i < 100 && !running; i++) {
    running = ((await (await page.request.get('/site/job')).json()) as Job).running;
    if (!running) await page.waitForTimeout(50);
  }
  expect(running?.kind).toBe('preview');
  await expect(cardTitle(page, 'Vorschau bereit')).toBeVisible({ timeout: 180_000 });
  // Die Kurzbilanz hält alle drei Zahlen in einer Zeile, die Dateien stehen zugeklappt darunter.
  // (Die Historie darunter nennt ihre Änderungen im selben Wortlaut; die Karte steht zuerst.)
  await expect(page.getByText(/\d+ geändert · \d+ neu · 0 entfallen/).first()).toBeVisible();
  await expect(page.getByText('aktuelles/sommerfest/index.html')).toBeHidden();
  await page.getByText('Einzelheiten: Dateien und Hinweise').click();
  await expect(page.getByText('aktuelles/sommerfest/index.html')).toBeAttached();
  // Danach ist nichts mehr gemeldet und nichts mehr angezeigt.
  expect(((await (await page.request.get('/site/job')).json()) as Job).running).toBeNull();
  await expect(page.getByTestId('site-job')).toHaveCount(0);
  const preview = await page.request.get('/site/preview/aktuelles/sommerfest/');
  expect(preview.ok()).toBe(true);
  expect(await preview.text()).toContain('Sommerfest 2026');
  // Die Vorschau öffnet einen eigenen Tab: Die Publizieren-Seite behält die
  // gebaute Vorschau. Bis 0.2.0 öffnete sie im selben Tab, und wer zurückging,
  // fand beides leer (2026-09-19).
  const [tab] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: 'Vorschau öffnen' }).click()]);
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(/\/site\/preview-frame$/);
  await expect(tab.getByTestId('env-banner')).toBeVisible();
  // Wer die Vorschauseite direkt aufruft, kommt zurück.
  await expect(tab.getByRole('link', { name: 'Zurück zu Publizieren' })).toHaveAttribute('href', '/site/publish');
  // Die Vorschau lässt sich auf Telefon- und Tablet-Breite schalten.
  const frame = tab.getByTitle('Vorschau');
  await expect(frame).not.toHaveCSS('width', '390px');
  await tab.getByRole('button', { name: /Mobil/ }).click();
  await expect(frame).toHaveCSS('width', '390px');
  await tab.getByRole('button', { name: /Tablet/ }).click();
  await expect(frame).toHaveCSS('width', '820px');

  // Der erste Tab steht unverändert: Die Vorschau ist noch da.
  await expect(page).toHaveURL('/site/publish');
  await expect(cardTitle(page, 'Vorschau bereit')).toBeVisible();

  // Die gebaute Seite selbst bei Handybreite: nichts ragt über den Rand, das Menü öffnet.
  await tab.setViewportSize({ width: 390, height: 844 });
  await tab.goto('/site/preview/');
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await tab.getByRole('button', { name: 'Menü' }).click();
  await expect(tab.getByRole('link', { name: 'Aktuelles' })).toBeVisible();
  await tab.close();

  // Publiziert wird ohne neuen Vorschau-Lauf: Die Seite hat die Vorschau nicht vergessen.
  await page.getByRole('button', { name: 'Auf Test publizieren' }).click();
  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog.getByRole('button', { name: 'Auf Test publizieren' })).toBeEnabled();
  await confirmDialog.getByRole('button', { name: 'Auf Test publizieren' }).click();
  // Der Dialog schließt beim Start; den Lauf zeigen Karte und Kopfzeile.
  await expect(confirmDialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Laufender Lauf' }).or(cardTitle(page, 'Publiziert'))).toBeVisible();
  await expect(cardTitle(page, 'Publiziert')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('site-job')).toHaveCount(0);
  const history = page.getByRole('table', { name: 'Letzte Publishes' });
  await expect(history.getByRole('row').nth(1)).toContainText('Publiziert');
  // Der Publish, der gerade zu Ende ging, trägt die Marke „neu“.
  await expect(history.getByRole('row').nth(1)).toContainText('neu');
  // Das Protokoll lädt erst beim Öffnen und liegt in einem Dialog, der mit Escape schließt.
  await history.getByRole('button', { name: 'Protokoll' }).first().click();
  const logDialog = page.getByRole('dialog', { name: /Protokoll/ });
  await expect(logDialog).toBeVisible();
  await expect(logDialog.locator('pre')).toBeVisible();
  await expect(logDialog.getByRole('button', { name: 'Kopieren' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(logDialog).toBeHidden();
  const fs = await import('node:fs');
  expect(fs.existsSync(path.join(process.env.E2E_SITE_TARGET!, 'aktuelles', 'sommerfest', 'index.html'))).toBe(true);

  // Der Publish ist verbraucht: Nach dem Neuladen steht er nicht mehr als „Publiziert“ da.
  await page.reload();
  await expect(cardTitle(page, 'Noch keine Vorschau')).toBeVisible();
});

test('publishing is blocked when content changed after the preview was built', async ({ page, context }) => {
  test.setTimeout(180_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await importTemplate(page);

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  await expect(cardTitle(page, 'Vorschau bereit')).toBeVisible({ timeout: 180_000 });

  // Der Inhalt ändert sich in einem zweiten Tab, ohne dass die Publish-Seite
  // im ersten Tab neu geladen wird — die dort gebaute Vorschau weiss davon nichts.
  const change = async (text: string) => {
    const second = await context.newPage();
    await second.goto('/site/variables');
    await waitForHydration(second, '[name="claim.de"]');
    await second.locator('[name="claim.de"]').fill(text);
    await second.getByRole('button', { name: 'Speichern' }).click();
    await expect(second.getByRole('status')).toContainText('Gespeichert');
    await second.close();
  };
  await change('Geänderter Claim nach der Vorschau.');

  // Ohne Neuladen: Der Dialog gleicht ab und bietet genau zwei Knöpfe.
  await page.getByRole('button', { name: 'Auf Test publizieren' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('alert')).toContainText('Vorschau nicht mehr aktuell');
  await expect(dialog.locator('[data-slot="dialog-footer"]').getByRole('button')).toHaveText(['Abbrechen', 'Vorschau neu bauen']);
  // Neu bauen schließt den Dialog und zeigt den Lauf in der Karte.
  await dialog.getByRole('button', { name: 'Vorschau neu bauen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Laufender Lauf' }).or(cardTitle(page, 'Vorschau bereit'))).toBeVisible();
  await expect(cardTitle(page, 'Vorschau bereit')).toBeVisible({ timeout: 180_000 });

  // Mit Neuladen: Die Karte nennt es gleich beim Öffnen der Seite.
  await change('Noch ein geänderter Claim.');
  await page.reload();
  await expect(cardTitle(page, 'Vorschau nicht mehr aktuell')).toBeVisible();
});

test('the preview reports a stale reference as a hint, not as a block', async ({ page }) => {
  test.setTimeout(180_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await importTemplate(page);

  await page.goto('/site/variables');
  await page.getByLabel('Projekt auf der Startseite').selectOption('winterhilfe');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/projects');
  await page.getByRole('row', { name: /Winterhilfe/ }).getByRole('switch').click();

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  await expect(cardTitle(page, 'Vorschau bereit')).toBeVisible({ timeout: 120_000 });
  await page.getByText('Einzelheiten: Dateien und Hinweise').click();
  const stale = page.getByRole('region', { name: 'Veraltete Verweise' });
  await stale.getByText(/Veraltete Verweise/).click();
  await expect(stale).toContainText('variables.featuredProject');
  await expect(stale).toContainText('winterhilfe');
  await expect(page.getByRole('region', { name: 'Publizieren gesperrt' })).toHaveCount(0);
});

/**
 * Die gebaute Seite rechnet mit der Wurzel, ausgeliefert wird sie unter
 * `/site/preview/`. Die Route schreibt die Pfade deshalb beim Ausliefern um —
 * eine Textumformung, die genau die Attribute trifft, an die jemand gedacht
 * hat. `srcset` fehlte, und das fiel niemandem auf: Wer daneben greift, landet
 * nicht auf einem 404, sondern auf der Oberfläche von Kompass, die mit 200 und
 * HTML antwortet. Im Browser blieb das Bild leer, im Protokoll stand nichts.
 *
 * Der Test prüft darum nicht ein Attribut, sondern die Regel: Kein absoluter
 * Pfad zeigt an der Vorschau vorbei. Kommt eines Tages ein Attribut dazu,
 * schlägt er fehl, statt still das Falsche auszuliefern.
 */
test('the preview rewrites every absolute path, srcset included', async ({ page }) => {
  test.setTimeout(240_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  // Nur Rasterbilder bekommen Varianten, und nur mit Varianten entsteht ein
  // `srcset` — ein SVG liefe an diesem Test vorbei.
  await page.goto('/admin/media');
  await page.getByLabel('Datei hochladen').setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('row', { name: /hero-/ })).toBeVisible();

  await importTemplate(page);

  await page.goto('/site/variables');
  await page.getByRole('button', { name: 'Bild auf der Startseite: Wählen' }).click();
  const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
  await chooser.getByRole('button', { name: /hero-/ }).click();
  await expect(chooser).toBeHidden();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  await expect(cardTitle(page, 'Vorschau bereit')).toBeVisible({ timeout: 180_000 });

  const html = await (await page.request.get('/site/preview/')).text();
  const leftovers = [...html.matchAll(/(\w[\w-]*)="(\/(?!site\/preview)[^"]*)"/g)].map((m) => `${m[1]}="${m[2]}"`);
  expect(leftovers).toEqual([]);

  // Und die Adresse aus dem `srcset` liefert wirklich ein Bild. Auf den Status
  // ist hier kein Verlass: Der ist auch im kaputten Zustand 200.
  const srcset = /srcset="([^"]+)"/.exec(html)?.[1];
  expect(srcset).toBeTruthy();
  const first = srcset!.split(',')[0]!.trim().split(' ')[0]!;
  const image = await page.request.get(first);
  expect(image.headers()['content-type']).toBe('image/webp');
});

/**
 * Die Laufanzeige hängt nicht an der Seite, die den Lauf gestartet hat: Ein
 * Assistent startet die Vorschau über MCP, die Kopfzeile jeder Seite zeigt sie,
 * und die Laufkarte bricht sie ab. Die Bremse hält den Export fest, weil der Bau
 * warm in unter einer Sekunde fertig wäre.
 */
test('a run started over MCP shows in the header and on the publish page and can be cancelled there', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await importTemplate(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Playwright');
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
  const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();
  await page.request.post('/__e2e/site-brake', { headers: { 'x-e2e-token': 'e2e-reset' }, data: { ms: 20_000 } });
  try {
    const client = new Client({ name: 'e2e', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    expect((await client.callTool({ name: 'site_preview_build', arguments: {} })).isError).toBeFalsy();
    await client.close();

    await page.goto('/');
    const indicator = page.getByTestId('site-job');
    await expect(indicator).toContainText('Vorschau');
    await indicator.click();
    await expect(page).toHaveURL('/site/publish');
    const run = page.getByRole('region', { name: 'Laufender Lauf' });
    await expect(run).toContainText('MCP');
    await run.getByRole('button', { name: 'Abbrechen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lauf abbrechen' }).click();
    await expect(run).toHaveCount(0, { timeout: 60_000 });
    await expect(indicator).toHaveCount(0);
    // Abgebrochen ist kein Fehler: Die Karte nennt den Schritt, ohne eine zweite Region „Letzter Lauf“.
    await expect(cardTitle(page, 'Vorschau abgebrochen')).toBeVisible();
    await expect(page.getByText('bei „Inhalte prüfen“')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Letzter Lauf: Vorschau' })).toHaveCount(0);
  } finally {
    await page.request.post('/__e2e/site-brake', { headers: { 'x-e2e-token': 'e2e-reset' }, data: { ms: 0 } });
  }
});
