import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, waitForHydration } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF',
);

const folderTree = (page: Page) => page.getByRole('tree', { name: 'Ordner' });
/** Eine Zeile des Baums; ihr zugänglicher Name trägt die Zähler („Bilder, 3 Dateien, davon 1 direkt“). */
const treeRow = (page: Page, name: string) => folderTree(page).getByRole('treeitem', { name: new RegExp(`^${name},`) });
const toastWith = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });
const assetRows = (page: Page) => page.locator('tbody tr');

async function expandFolder(page: Page, name: string) {
  const item = treeRow(page, name);
  await item.locator('[data-toggle]').click();
  await expect(item).toHaveAttribute('aria-expanded', 'true');
}

/** Die Summe, die der Baum am Ordner nennt — aus dem zugänglichen Namen („Bilder, 3 Dateien“ oder „…, leer“). */
async function treeTotal(page: Page, name: string): Promise<number> {
  const label = (await treeRow(page, name).getAttribute('aria-label')) ?? '';
  return Number(label.match(/^[^,]+, (\d+)/)?.[1] ?? 0);
}

test.describe('media library', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('opens the detail dialog and blocks deleting an asset that is in use', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('hofprojekt');
    await page.locator('[name="name.de"]').fill('Hofprojekt');
    await page.locator('[name="summary.de"]').fill('Kurztext.');
    await page.getByRole('button', { name: 'Bild: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles({ name: 'hof.png', mimeType: 'image/png', buffer: PNG });
    await expect(chooser).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /hof-/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Projekt „hofprojekt“');
    await expect(dialog.getByRole('button', { name: 'Löschen' })).toBeDisabled();
  });

  test('uploads a file, inspects it in the dialog and deletes it while unused', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'frei.png', mimeType: 'image/png', buffer: PNG });

    await page.getByRole('row', { name: /frei-/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('nicht verwendet');
    await dialog.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByRole('row', { name: /frei-/ })).toHaveCount(0);
  });

  test('serves a file sandboxed, so an SVG cannot run in the origin of the app', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'sandbox.png', mimeType: 'image/png', buffer: PNG });
    const src = await page.getByRole('row', { name: /sandbox-/ }).locator('img').getAttribute('src');
    expect(src).toMatch(/^\/media\//);
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-security-policy']).toBe('sandbox');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('says so when the same bytes are uploaded a second time, and names the folder they live in', async ({ page }) => {
    await page.goto('/admin/media');
    await treeRow(page, 'Dokumente').click();
    await expect(page).toHaveURL(/folder=Dokumente$/);
    await waitForHydration(page, 'input[type=file]');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'einmal.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /einmal-/ })).toBeVisible();

    await page.getByRole('link', { name: /^Alle Dateien/ }).click();
    await expect(page).toHaveURL('/admin/media');
    await waitForHydration(page, 'input[type=file]');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'zweimal.png', mimeType: 'image/png', buffer: PNG });
    // Wie beim Ablegen: ein Fehler-Toast mit Grund, kein Erfolg.
    const refused = toastWith(page, /Keine Datei hochgeladen/);
    await expect(refused).toBeVisible();
    await expect(refused).toContainText('„zweimal.png“ nicht hochgeladen');
    await expect(refused).toContainText(/Diese Datei gibt es schon: „einmal-[0-9a-f]+\.png“ im Ordner „Dokumente“/);
    await expect(page.getByRole('row', { name: /zweimal-/ })).toHaveCount(0);
  });

  test('remembers the grid view across a reload', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveClass(/bg-selected/);
  });

  test('serves a webp preview for an uploaded image, sandboxed', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'vorschau.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('row', { name: /vorschau-/ }).click();
    const src = await page.getByRole('dialog').locator('img').getAttribute('src');
    const id = src!.replace(/\/preview$/, '').split('/').at(-1)!;
    const response = await page.request.get(`/media/${id}/preview`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/webp');
    expect(response.headers()['content-security-policy']).toBe('sandbox');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    const missing = await page.request.get('/media/NOPE/preview');
    expect(missing.status()).toBe(404);
  });

  test('GET /media answers the listing as JSON and refuses bad parameters', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'json.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /json-/ })).toBeVisible();
    const ok = await page.request.get('/media?query=json&sort=name');
    expect(ok.status()).toBe(200);
    const body = (await ok.json()) as { items: { filename: string }[]; folders: unknown[] };
    expect(body.items.map((i) => i.filename)).toEqual([expect.stringMatching(/^json-/)]);
    expect((await page.request.get('/media?kind=video')).status()).toBe(400);
  });

  test('searches by usage, filters by kind, sorts by name, and links the usage', async ({ page }) => {
    // Ein Hund mit Foto — die Suche soll ihn über das Verwendungs-Label finden.
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('rex');
    await page.getByLabel('Name').fill('Rex');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    const animalUrl = page.url();
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles({ name: 'rex-foto.png', mimeType: 'image/png', buffer: PNG });
    await expect(chooser.getByText('1 von 12 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');

    // Ein PDF für den Typfilter
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'mitgliederordnung.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByRole('row', { name: /mitgliederordnung-/ })).toBeVisible();

    await page.getByLabel('Suchen').fill('Rex');
    await page.getByRole('button', { name: 'Filtern' }).click();
    await expect(page).toHaveURL(/q=Rex/);
    await expect(page.getByRole('row', { name: /rex-foto-/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /mitgliederordnung-/ })).toHaveCount(0);

    await page.goto('/admin/media?kind=pdf');
    await expect(page.getByRole('row', { name: /mitgliederordnung-/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /rex-foto-/ })).toHaveCount(0);

    await page.goto('/admin/media?sort=name');
    // Nur der Dateiname, nicht die Typ-Badge davor (die für PDF „PDF“ zeigt).
    const names = await page.locator('tbody tr td:first-child span.font-mono').allInnerTexts();
    expect(names.map((n) => n.trim())).toEqual([...names.map((n) => n.trim())].sort((a, b) => a.localeCompare(b)));

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /rex-foto-/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: 'Öffnen' })).toHaveAttribute('href', /^\/media\/[0-9A-Z]{26}$/);
    await dialog.getByRole('link', { name: 'Tier „Rex“' }).click();
    await expect(page).toHaveURL(animalUrl);
  });

  test('a file without a folder says so, and the list shows folder and date', async ({ page }) => {
    await page.goto('/admin/media');
    await waitForHydration(page, 'input[type=file]');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'lose.png', mimeType: 'image/png', buffer: PNG });
    const row = page.getByRole('row', { name: /lose-/ });
    await expect(row).toContainText('Ohne Ordner');
    await row.click();
    await expect(page.getByRole('dialog')).toContainText('Ohne Ordner');
  });
});

test.describe('Ordnerbaum der Mediathek', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('zeigt oben „Alle Dateien“ und „Ohne Ordner“, und die Formulare unter dem alten Baum gibt es nicht mehr', async ({ page }) => {
    await page.goto('/admin/media');
    const fixed = page.locator('[data-fixed]');
    await expect(fixed).toHaveCount(2);
    await expect(fixed.nth(0)).toContainText('Alle Dateien');
    await expect(fixed.nth(1)).toContainText('Ohne Ordner');
    await expect(fixed.nth(0)).toHaveAttribute('aria-current', 'page');
    await expect(treeRow(page, 'Bilder')).toBeVisible();
    await expect(page.getByLabel('Ordnername')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ordner löschen' })).toHaveCount(0);
    // „Hochladen“ steht als Knopf im Seitenkopf.
    await expect(page.getByRole('button', { name: 'Hochladen', exact: true })).toBeVisible();
  });

  test('„Neuer Ordner“ legt oben an, „Neuer Unterordner“ am Knoten darunter', async ({ page }) => {
    await page.goto('/admin/media?folder=Bilder');
    await waitForHydration(page, '[role="tree"]');
    await page.getByRole('button', { name: 'Neuer Ordner', exact: true }).click();
    const input = folderTree(page).getByRole('textbox', { name: 'Name des Ordners' });
    await input.fill('Kampagnen');
    await expect(input).toHaveValue('Kampagnen');
    await input.press('Enter');
    await expect(page.locator('[data-folder="Kampagnen"]')).toBeVisible();

    await treeRow(page, 'Kampagnen').locator('[data-row-menu]').click();
    await page.getByRole('menuitem', { name: 'Neuer Unterordner' }).click();
    const sub = folderTree(page).getByRole('textbox', { name: 'Name des Ordners' });
    await sub.fill('Frühjahr');
    await expect(sub).toHaveValue('Frühjahr');
    await sub.press('Enter');
    await expect(page.locator('[data-folder="Kampagnen/Frühjahr"]')).toBeVisible();
  });

  test('benennt per F2 um, und die Adresse folgt', async ({ page }) => {
    await page.goto('/admin/media?folder=Dokumente');
    await waitForHydration(page, '[role="tree"]');
    await expect(treeRow(page, 'Dokumente')).toHaveAttribute('aria-current', 'page');
    await treeRow(page, 'Dokumente').focus();
    await page.keyboard.press('F2');
    const input = folderTree(page).getByRole('textbox', { name: 'Name des Ordners' });
    await expect(input).toHaveValue('Dokumente');
    await input.fill('Unterlagen');
    await expect(input).toHaveValue('Unterlagen');
    await input.press('Enter');

    await expect(page).toHaveURL(/folder=Unterlagen$/);
    await expect(treeRow(page, 'Unterlagen')).toHaveAttribute('aria-current', 'page');
    await expect(toastWith(page, 'Ordner Dokumente in Unterlagen umbenannt')).toBeVisible();
    await expect(assetRows(page).filter({ hasText: /satzung-entwurf-/i })).toHaveCount(1);
  });

  test('löscht einen leeren Ordner ohne Rückfrage; „Rückgängig“ legt ihn neu an', async ({ page }) => {
    await page.goto('/admin/media');
    await waitForHydration(page, '[role="tree"]');
    await page.getByRole('button', { name: 'Neuer Ordner', exact: true }).click();
    const input = folderTree(page).getByRole('textbox', { name: 'Name des Ordners' });
    await input.fill('Leer');
    await expect(input).toHaveValue('Leer');
    await input.press('Enter');
    await treeRow(page, 'Leer').click();
    await expect(page).toHaveURL(/folder=Leer$/);

    await treeRow(page, 'Leer').locator('[data-row-menu]').click();
    await page.getByRole('menuitem', { name: 'Löschen' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL('/admin/media');
    await expect(page.locator('[data-folder="Leer"]')).toHaveCount(0);

    await toastWith(page, 'Ordner Leer gelöscht').getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.locator('[data-folder="Leer"]')).toBeVisible();
    await expect(toastWith(page, 'Ordner Leer ist wieder da')).toBeVisible();
  });

  test('„Ohne Ordner“ zeigt nur Dateien, die in keinem Ordner liegen', async ({ page }) => {
    await page.goto('/admin/media');
    await page.locator('[data-fixed="unfiled"]').click();
    await expect(page).toHaveURL(/unfiled=1/);
    await expect(page.locator('[data-fixed="unfiled"]')).toHaveAttribute('aria-current', 'page');
    await expect(assetRows(page).filter({ hasText: /notiz-/i })).toHaveCount(1);
    await expect(assetRows(page).filter({ hasText: /vereinsbanner-/i })).toHaveCount(0);
    await expect(assetRows(page)).toHaveCount(2);
  });

  test('„Bilder“ geöffnet zeigt auch die Dateien der Unterordner, so viele, wie der Baum zählt', async ({ page }) => {
    await page.goto('/admin/media');
    await treeRow(page, 'Bilder').click();
    await expect(page).toHaveURL(/folder=Bilder$/);
    const total = await treeTotal(page, 'Bilder');
    expect(total).toBe(3);
    await expect(assetRows(page)).toHaveCount(total);
    const deep = assetRows(page).filter({ hasText: /sommerfest-wiese-/i });
    await expect(deep.locator('[data-folder-cell]')).toHaveText('2026 › Sommerfest');
    await expect(assetRows(page).filter({ hasText: /vereinsbanner-/i }).locator('[data-folder-cell]')).toHaveText('');

    await expandFolder(page, 'Bilder');
    await treeRow(page, '2026').click();
    await expect(page).toHaveURL(/folder=Bilder%2F2026$/);
    await expect(assetRows(page)).toHaveCount(2);
    await expect(deep.locator('[data-folder-cell]')).toHaveText('Sommerfest');
  });
  test('Detaildialog: der Ort als Weg, „Verschieben nach…“ verschiebt mit Toast und Rückgängig', async ({ page }) => {
    await page.goto('/admin/media?folder=Bilder');
    await waitForHydration(page, '[role="tree"]');
    await assetRows(page).filter({ hasText: /hoftor-/i }).click();
    const detail = page.getByRole('dialog', { name: /hoftor-/i });
    await expect(detail.locator('[data-folder-path]')).toHaveText('Bilder › 2026');
    await expect(detail.locator('select')).toHaveCount(0);

    await detail.getByRole('button', { name: 'Verschieben nach…' }).click();
    const move = page.getByRole('dialog', { name: /verschieben nach…$/ });
    await move.getByRole('treeitem', { name: /^Dokumente,/ }).click();
    await move.getByRole('button', { name: 'Nach „Dokumente“ verschieben' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await toastWith(page, /„hoftor-[0-9a-f]+\.png“ nach Dokumente verschoben/i).getByRole('button', { name: 'Rückgängig' }).click();
    await expect(toastWith(page, /„hoftor-[0-9a-f]+\.png“ liegt wieder in 2026/i)).toBeVisible();
    await expect(assetRows(page).filter({ hasText: /hoftor-/i }).locator('[data-folder-cell]')).toHaveText('2026');
  });

  test('Auswahldialog: Baum nur mit passenden Ordnern, Klick wählt und zeigt den Teilbaum', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByRole('button', { name: 'Bild: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    const tree = chooser.getByRole('tree', { name: 'Ordner' });
    await expect(tree.getByRole('treeitem', { name: /^Bilder,/ })).toBeVisible();
    // „Dokumente“ hält nur ein PDF: Im Bild-Dialog hat er nichts zu bieten (Handoff § 9.2).
    await expect(tree.getByRole('treeitem', { name: /^Dokumente,/ })).toHaveCount(0);
    await expect(chooser.locator('[data-fixed="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(tree.locator('a, [data-row-menu], [draggable="true"]')).toHaveCount(0);

    await tree.getByRole('treeitem', { name: /^Bilder,/ }).click();
    await expect(tree.getByRole('treeitem', { name: /^Bilder,/ })).toHaveAttribute('aria-selected', 'true');
    await expect(chooser.getByRole('button', { name: /sommerfest-wiese-/i })).toBeVisible();
    await expect(chooser.getByRole('button', { name: /haken-/i })).toHaveCount(0);

    await chooser.getByRole('button', { name: /vereinsbanner-/i }).click();
    await expect(chooser).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
  });
});

/**
 * Ziehen in der Mediathek (README § 3, Artboard 7): Kacheln auf Ordner,
 * Dateien aus dem Dateimanager direkt in einen Ordner. Ziehen lässt sich nicht
 * mit der Maus nachstellen; nachgestellt wird, was im Fenster ankommt.
 */
test.describe('Ziehen in der Mediathek', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  const tile = (page: Page, name: RegExp) => page.locator('[data-asset-id]').filter({ hasText: name });

  async function openGrid(page: Page, url: string) {
    await page.goto(url);
    await waitForHydration(page, '[role="tree"]');
    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    await expect(page.locator('[data-asset-id]').first()).toBeVisible();
  }

  /**
   * Zieht die Kachel, deren Dateiname auf `name` passt, auf `target`:
   * `dragstart` an der Kachel (sie legt das Ziehgut in den DataTransfer), dann
   * die Ereignisse am Ziel; `dragend` nur, wenn die Kachel noch steht.
   */
  async function dragTile(page: Page, name: RegExp, target: string) {
    await expect(tile(page, name)).toHaveCount(1);
    await expect(page.locator(target).first()).toBeAttached();
    await page.evaluate(
      ({ source, flags, target }) => {
        const re = new RegExp(source, flags);
        const from = [...document.querySelectorAll<HTMLElement>('[data-asset-id]')].find((el) => re.test(el.textContent ?? ''))!;
        const to = document.querySelector(target)!;
        const transfer = new DataTransfer();
        from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
        for (const type of ['dragenter', 'dragover', 'drop']) to.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
        if (from.isConnected) from.dispatchEvent(new DragEvent('dragend', { dataTransfer: transfer, bubbles: true }));
      },
      { source: name.source, flags: name.flags, target }
    );
  }

  /**
   * Dateien aus dem Dateimanager: ein DataTransfer mit Dateien auf `target`.
   * `drop: false` bleibt beim Überfahren stehen, damit die Ablagefläche zu sehen ist.
   */
  async function dropFiles(page: Page, target: string, files: { name: string; type: string; base64: string }[], drop = true) {
    // Die Horcher hängen an einem Effekt; vor der Hydration geht der Zug ins Leere.
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();
    await expect(page.locator(target).first()).toBeAttached();
    await page.evaluate(
      ({ target, files, drop }) => {
        const transfer = new DataTransfer();
        for (const f of files) transfer.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
        const to = document.querySelector(target)!;
        for (const type of drop ? ['dragenter', 'dragover', 'drop'] : ['dragenter', 'dragover']) {
          to.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
        }
      },
      { target, files, drop }
    );
  }

  const png = (name: string) => ({ name, type: 'image/png', base64: PNG.toString('base64') });

  async function createTopFolder(page: Page, name: string) {
    await page.getByRole('button', { name: 'Neuer Ordner', exact: true }).click();
    const input = folderTree(page).getByRole('textbox', { name: 'Name des Ordners' });
    await input.fill(name);
    await expect(input).toHaveValue(name);
    await input.press('Enter');
    await expect(page.locator(`[data-folder="${name}"]`)).toBeVisible();
  }

  test('zieht eine Kachel auf „Sommerfest“ und nimmt es mit „Rückgängig“ zurück', async ({ page }) => {
    await openGrid(page, '/admin/media?folder=Bilder');
    await expandFolder(page, 'Bilder');
    await expandFolder(page, '2026');

    await dragTile(page, /vereinsbanner-/i, '[data-folder="Bilder/2026/Sommerfest"]');
    const toast = toastWith(page, /„vereinsbanner-.*“ nach Sommerfest verschoben/);
    await expect(toast).toBeVisible();
    await expect(tile(page, /vereinsbanner-/i).locator('[data-folder-cell]')).toHaveText('2026 › Sommerfest');

    await toast.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(toastWith(page, /„vereinsbanner-.*“ liegt wieder in Bilder/)).toBeVisible();
    await expect(tile(page, /vereinsbanner-/i).locator('[data-folder-cell]')).toHaveCount(0);
  });

  /** Wie viele Dateien die Mediathek hat — ein heimlicher Upload ließe die Zahl steigen. */
  const assetTotal = (page: Page) => page.evaluate(() => fetch('/media').then((r) => r.json()).then((j: { total: number }) => j.total));

  /**
   * Abnahme 01.10.: Eine Kachel auf einen Ordner gezogen lud eine Kopie hoch,
   * statt zu verschieben. Der Browser zog das Vorschaubild selbst und legte es
   * als Datei bei. Hier ein echter Mauszug, kein nachgebautes Ereignis: Er
   * beginnt am Bild, und gezogen werden muss trotzdem die Kachel.
   */
  test('mit der Maus gezogen verschiebt die Kachel, statt ihr Bild hochzuladen', async ({ page }) => {
    await openGrid(page, '/admin/media?folder=Bilder');
    const before = await assetTotal(page);
    const image = tile(page, /vereinsbanner-/i).locator('img');
    await expect(image).toBeVisible();
    const from = (await image.boundingBox())!;
    const to = (await page.locator('[data-folder="Dokumente"]').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
    await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(toastWith(page, /„vereinsbanner-.*“ nach Dokumente verschoben/)).toBeVisible();
    await expect(toastWith(page, /hochgeladen/)).toHaveCount(0);
    expect(await assetTotal(page)).toBe(before);
  });

  /**
   * Befund 8: In der Listenansicht ließ sich nichts ziehen. Echter Mauszug von
   * der Zeile (am Dateinamen, wo man sie greift) auf einen Ordner.
   */
  test('mit der Maus gezogen verschiebt eine Listenzeile auf einen Ordner', async ({ page }) => {
    await page.goto('/admin/media?folder=Bilder');
    await waitForHydration(page, '[role="tree"]');
    await page.getByRole('button', { name: 'Liste', exact: true }).click();
    const row = assetRows(page).filter({ hasText: /vereinsbanner-/i });
    await expect(row).toBeVisible();
    const before = await assetTotal(page);
    const from = (await row.locator('span.font-mono').boundingBox())!;
    const to = (await page.locator('[data-folder="Dokumente"]').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
    await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();

    const toast = toastWith(page, /„vereinsbanner-.*“ nach Dokumente verschoben/);
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Rückgängig' })).toBeVisible();
    await expect(toastWith(page, /hochgeladen/)).toHaveCount(0);
    expect(await assetTotal(page)).toBe(before);
  });

  /**
   * Was Playwright beim Mauszug nicht nachbildet: Chrome legt dem Zug aus der
   * Seite das Bild als `Files` bei. Ein Zug, der hier begann, ist nie ein
   * Hochladen — mit eigenem Ziehgut verschiebt er, ohne (Vorschaubild der
   * Liste) tut er nichts.
   */
  test('ein Zug aus der Seite mit beigelegter Bilddatei verschiebt und lädt nichts hoch', async ({ page }) => {
    await openGrid(page, '/admin/media?folder=Bilder');
    const before = await assetTotal(page);
    await page.evaluate((base64) => {
      const from = [...document.querySelectorAll<HTMLElement>('[data-asset-id]')].find((el) => /vereinsbanner-/i.test(el.textContent ?? ''))!;
      const to = document.querySelector('[data-folder="Dokumente"]')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }));
      from.querySelector('img')!.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      for (const type of ['dragenter', 'dragover', 'drop']) to.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      if (from.isConnected) from.dispatchEvent(new DragEvent('dragend', { dataTransfer: transfer, bubbles: true }));
    }, PNG.toString('base64'));
    await expect(toastWith(page, /„vereinsbanner-.*“ nach Dokumente verschoben/)).toBeVisible();
    await expect(toastWith(page, /hochgeladen/)).toHaveCount(0);
    expect(await assetTotal(page)).toBe(before);

    // Auch ein Zug am Vorschaubild der Liste (mit beigelegter Datei) lädt nichts hoch.
    await page.getByRole('button', { name: 'Liste', exact: true }).click();
    await expect(assetRows(page).first()).toBeVisible();
    await page.evaluate((base64) => {
      const thumb = document.querySelector('tbody tr img')!;
      const to = document.querySelector('[data-folder="Dokumente"]')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }));
      thumb.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      for (const type of ['dragenter', 'dragover', 'drop']) to.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      thumb.dispatchEvent(new DragEvent('dragend', { dataTransfer: transfer, bubbles: true }));
    }, PNG.toString('base64'));
    await expect(toastWith(page, /hochgeladen/)).toHaveCount(0);
    expect(await assetTotal(page)).toBe(before);
  });

  test('eine Kachel auf „Ohne Ordner“ liegt danach ohne Ordner', async ({ page }) => {
    await openGrid(page, '/admin/media?folder=Bilder');
    await dragTile(page, /vereinsbanner-/i, '[data-fixed="unfiled"]');
    await expect(toastWith(page, /„vereinsbanner-.*“ nach „Ohne Ordner“ verschoben/)).toBeVisible();
    await expect(tile(page, /vereinsbanner-/i)).toHaveCount(0);

    await page.locator('[data-fixed="unfiled"]').click();
    await expect(page).toHaveURL(/unfiled=1/);
    await expect(tile(page, /vereinsbanner-/i)).toHaveCount(1);
  });

  test('mit Suchbegriff gezogen bleibt der Filter stehen', async ({ page }) => {
    await openGrid(page, '/admin/media?folder=Bilder&q=vereinsbanner');
    await expect(page.locator('[data-asset-id]')).toHaveCount(1);
    await expandFolder(page, 'Bilder');
    await expandFolder(page, '2026');

    await dragTile(page, /vereinsbanner-/i, '[data-folder="Bilder/2026/Sommerfest"]');
    await expect(toastWith(page, /nach Sommerfest verschoben/)).toBeVisible();
    await expect(tile(page, /vereinsbanner-/i).locator('[data-folder-cell]')).toHaveText('2026 › Sommerfest');
    await expect(page).toHaveURL(/q=vereinsbanner/);
    await expect(page.getByRole('searchbox', { name: 'Suchen' })).toHaveValue('vereinsbanner');
    await expect(page.locator('[data-asset-id]')).toHaveCount(1);
  });

  test('eine Datei auf „Vereinsheim“ wird sofort dort hochgeladen, ohne „Rückgängig“', async ({ page }) => {
    await page.goto('/admin/media?folder=Bilder');
    await waitForHydration(page, '[role="tree"]');
    await createTopFolder(page, 'Vereinsheim');

    await dropFiles(page, '[data-folder="Vereinsheim"]', [png('Vereinsheim Eingang.png')], false);
    await expect(page.getByText('1 Datei in „Vereinsheim“ hochladen')).toBeVisible();
    await dropFiles(page, '[data-folder="Vereinsheim"]', [png('Vereinsheim Eingang.png')]);

    const toast = toastWith(page, '1 Datei nach Vereinsheim hochgeladen');
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Rückgängig' })).toHaveCount(0);
    await toast.getByRole('button', { name: 'Ordner öffnen' }).click();
    await expect(page).toHaveURL(/folder=Vereinsheim$/);
    await expect(assetRows(page).filter({ hasText: /vereinsheim-eingang/i })).toHaveCount(1);
  });

  test('im Raster losgelassen landet die Datei im geöffneten Ordner', async ({ page }) => {
    await page.goto('/admin/media?folder=Dokumente');
    await waitForHydration(page, '[role="tree"]');

    await dropFiles(page, 'main', [png('Plakat.png')], false);
    await expect(page.getByText('Lassen Sie hier im Raster los, landen die Dateien im geöffneten Ordner „Dokumente“.', { exact: false })).toBeVisible();
    await dropFiles(page, 'main', [png('Plakat.png')]);

    await expect(toastWith(page, '1 Datei nach Dokumente hochgeladen')).toBeVisible();
    await expect(assetRows(page).filter({ hasText: /plakat/i })).toHaveCount(1);
  });

  test('die Ablagefläche verschwindet auch, wenn der Baum das Ablegen ohne Datei schluckt', async ({ page }) => {
    await page.goto('/admin/media?folder=Dokumente');
    await waitForHydration(page, '[role="tree"]');
    const overlay = page.getByText('Lassen Sie hier im Raster los', { exact: false });

    await page.evaluate(() => {
      const hidden = { types: ['Files'], items: { length: 0 }, files: { length: 0 } };
      for (const [type, target] of [['dragenter', 'main'], ['drop', '[data-folder="Bilder"]']] as const) {
        const event = new DragEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: hidden });
        document.querySelector(target)!.dispatchEvent(event);
      }
    });

    await expect(overlay).toHaveCount(0);
  });

  test('auf „Alle Dateien“ losgelassen landet die Datei wie im Raster im geöffneten Ordner', async ({ page }) => {
    await page.goto('/admin/media?folder=Dokumente');
    await waitForHydration(page, '[role="tree"]');

    await dropFiles(page, '[data-fixed="all"]', [png('Aushang.png')]);

    await expect(toastWith(page, '1 Datei nach Dokumente hochgeladen')).toBeVisible();
    await expect(assetRows(page).filter({ hasText: /aushang/i })).toHaveCount(1);
  });

  test('von zwei Dateien lädt die erlaubte hoch, und der Toast nennt die andere mit Grund', async ({ page }) => {
    await page.goto('/admin/media');
    await waitForHydration(page, '[role="tree"]');
    await createTopFolder(page, 'Vereinsheim');

    await dropFiles(page, '[data-folder="Vereinsheim"]', [png('Grundriss.png'), { name: 'liesmich.txt', type: 'text/plain', base64: Buffer.from('Hallo').toString('base64') }]);

    const toast = toastWith(page, '1 Datei nach Vereinsheim hochgeladen');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('„liesmich.txt“ nicht hochgeladen: Dateityp nicht unterstützt');
    await expect(toast.getByRole('button', { name: 'Ordner öffnen' })).toBeVisible();
    await page.goto('/admin/media?folder=Vereinsheim');
    await expect(assetRows(page)).toHaveCount(1);
    await expect(assetRows(page).filter({ hasText: /grundriss/i })).toHaveCount(1);
  });
});
