import path from 'node:path';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('publish page runs the checks and blocks on a blocked term', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await setE2ESetting(page, 'site.blockedTerms', ['Popescu']);

  await page.goto('/site/variables');
  await page.locator('[name="claim.de"]').fill('Frau Popescu betreibt den Verein.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Prüfen' }).click();
  const violations = page.getByRole('region', { name: 'Sperrworttreffer' });
  await expect(violations).toContainText('variables.claim');
  await expect(violations).toContainText('Popescu');
  await expect(page.getByRole('button', { name: /publizieren/i })).toHaveCount(0);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Webseite' })).toBeVisible();
});

test('preview build, diff and publish to the local staging target', async ({ page }) => {
  test.setTimeout(240_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

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
  // Während des Baus meldet /site/job, was läuft und seit wann; die Seite
  // fragt das sekündlich ab. Warm baut das Basis-Template in unter einer
  // Sekunde, deshalb fragt der Test selbst sofort nach dem Klick.
  type Job = { name: string; startedAt: string };
  let running: Job | null = null;
  for (let i = 0; i < 100 && !running; i++) {
    running = (await (await page.request.get('/site/job')).json()) as Job | null;
    if (!running) await page.waitForTimeout(50);
  }
  expect(running?.name).toBe('preview');
  await expect(page.getByRole('region', { name: 'Änderungen gegenüber Live' })).toContainText('aktuelles/sommerfest/index.html', { timeout: 180_000 });
  // Danach ist nichts mehr gemeldet und nichts mehr angezeigt.
  expect(await (await page.request.get('/site/job')).json()).toBeNull();
  await expect(page.getByTestId('site-job')).toHaveCount(0);
  const preview = await page.request.get('/site/preview/aktuelles/sommerfest/');
  expect(preview.ok()).toBe(true);
  expect(await preview.text()).toContain('Sommerfest 2026');
  await page.getByRole('link', { name: 'Vorschau öffnen' }).click();
  await expect(page.getByTestId('env-banner')).toBeVisible();
  // Die Vorschau lässt sich auf Telefon- und Tablet-Breite schalten.
  const frame = page.getByTitle('Vorschau');
  await expect(frame).not.toHaveCSS('width', '390px');
  await page.getByRole('button', { name: /Mobil/ }).click();
  await expect(frame).toHaveCSS('width', '390px');
  await page.getByRole('button', { name: /Tablet/ }).click();
  await expect(frame).toHaveCSS('width', '820px');

  // Die gebaute Seite selbst bei Handybreite: nichts ragt über den Rand, das Menü öffnet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/site/preview/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Menü' }).click();
  await expect(page.getByRole('link', { name: 'Aktuelles' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Nach Staging publizieren' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Jetzt publizieren' }).click();
  await expect(page.getByRole('status')).toContainText('Publiziert', { timeout: 180_000 });
  await expect(page.getByRole('table', { name: 'Publish-Historie' }).getByRole('row').nth(1)).toContainText('success');
  const fs = await import('node:fs');
  expect(fs.existsSync(path.join(process.env.E2E_SITE_TARGET!, 'aktuelles', 'sommerfest', 'index.html'))).toBe(true);
});

test('the connection test lists what a publish would remove and touches nothing', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  // Die Publizieren-Seite gibt es erst mit eingelesenem Template.
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');
  const fs = await import('node:fs');
  const target = process.env.E2E_SITE_TARGET!;
  fs.mkdirSync(target, { recursive: true });
  const stranger = path.join(target, 'fremde-datei.html');
  fs.writeFileSync(stranger, '<html>WordPress</html>');

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Verbindung testen' }).click();
  const result = page.getByRole('region', { name: 'Verbindungstest' });
  await expect(result).toContainText('fremde-datei.html', { timeout: 60_000 });

  expect(fs.readFileSync(stranger, 'utf8')).toBe('<html>WordPress</html>');
});

test('the check reports a stale reference as a warning, not as a block', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  await page.getByLabel('Projekt auf der Startseite').selectOption('winterhilfe');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/projects');
  await page.getByRole('row', { name: /Winterhilfe/ }).getByRole('switch').click();

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Prüfen' }).click();
  const stale = page.getByRole('region', { name: 'Veraltete Verweise' });
  await expect(stale).toContainText('variables.featuredProject');
  await expect(stale).toContainText('winterhilfe');
  await expect(page.getByRole('region', { name: 'Sperrworttreffer' })).toContainText('Keine Treffer');
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

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  await page.getByRole('button', { name: 'Bild auf der Startseite: Wählen' }).click();
  const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
  await chooser.getByRole('button', { name: /hero-/ }).click();
  await expect(chooser).toBeHidden();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  await expect(page.getByRole('region', { name: 'Änderungen gegenüber Live' })).toContainText('index.html', { timeout: 180_000 });

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
