import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { callTool, mcpClient, switchTo, switchToJonas } from './expense-helpers';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

const login = loginAsAdmin;
const FIXTURE_PDF = path.resolve(import.meta.dirname, 'fixtures/brief-digital.pdf');

/**
 * „Post ablegen“ liegt als Dialog über der Liste. Die Felder darin heissen wie
 * Dinge auf der Liste dahinter — „Betreff“ steht auch im Suchfeld —, deshalb
 * wird im Dialog gesucht und nicht auf der Seite.
 */
/*
 * Sonde, kein Fix: Unter Last verschluckt das Betreff-Feld des Dialogs
 * gelegentlich ein `fill` (Mechanismus C, Ursache unbekannt). Nach jedem
 * `fill` darauf steht deshalb `toHaveValue` — schlägt es fehl, zeigt der Trace
 * den Stand des Feldes an genau dieser Stelle statt erst beim Ablegen.
 */
function receiveDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Post ablegen' });
}

function folderTree(page: Page) {
  return page.getByRole('tree', { name: 'Ordner' });
}

/**
 * Das Ordnerfeld im Empfangsdialog: der Weg, wie er dasteht (Namen mit „›“),
 * und der Wert, den das versteckte Feld abschickt (`''` = Eingangskorb).
 */
async function expectFolder(scope: Locator, value: string, shown: string) {
  await expect(scope.locator('input[name="folder"]')).toHaveValue(value);
  await expect(scope.locator('[data-folder-path]')).toHaveText(shown);
}

/**
 * Benennt einen Ordner in einem zweiten Tab derselben Sitzung um — „inzwischen,
 * von anderer Hand“, während der erste Tab den alten Namen noch zeigt.
 */
async function renameFolderElsewhere(page: Page, path: string, newName: string) {
  const other = await page.context().newPage();
  await other.goto(`/dms?folder=${encodeURIComponent(path)}`);
  await other.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
  const row = folderTree(other).locator(`[data-folder="${path}"]`);
  await row.focus();
  await other.keyboard.press('F2');
  const input = folderTree(other).getByRole('textbox', { name: 'Name des Ordners' });
  await expect(input).toHaveValue(path.split('/').at(-1)!);
  await input.fill(newName);
  await expect(input).toHaveValue(newName);
  await input.press('Enter');
  await expect(other.locator('[data-sonner-toast]').filter({ hasText: `in ${newName} umbenannt` })).toBeVisible();
  await other.close();
}

/** Klappt einen Ordner über seinen Pfeil auf — der Name selbst navigiert. */
async function expandFolder(page: Page, name: string) {
  // Der zugängliche Name trägt die Zähler („behoerden, 9 Dokumente, davon 3 direkt“).
  const item = folderTree(page).getByRole('treeitem', { name: new RegExp(`^${name},`) });
  await item.locator('[data-toggle]').click();
  await expect(item).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Ziehen lässt sich aus dem Dateimanager nicht nachstellen; nachgestellt wird,
 * was im Fenster ankommt — eine Datei in einem DataTransfer auf einem Ziel.
 */
async function dropFiles(page: Page, selector: string, names: string[]) {
  // Die Horcher hängen an einem Effekt; vor der Hydration geht der Zug ins Leere.
  // Der Ordnerbaum baut seine Zeilen ebenfalls erst im Effekt.
  await expect(page.locator('[data-drop="ready"]')).toBeAttached();
  await expect(page.locator(selector).first()).toBeAttached();
  await page.evaluate(
    ({ selector, names }) => {
      const transfer = new DataTransfer();
      for (const name of names) {
        transfer.items.add(
          new File(['%PDF-1.4'], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'text/plain' })
        );
      }
      const target = document.querySelector(selector);
      if (!target) throw new Error(`kein Ziel: ${selector}`);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    },
    { selector, names }
  );
}

test.describe('dms', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  /**
   * Ein Datum sieht überall gleich aus, und wie, ist eine Einstellung (Befund 8,
   * 2026-09-12): aus der Sprache — bei Deutsch mit Punkten — oder ISO 8601.
   */
  test('zeigt Daten in der eingestellten Form, in Liste und Detail', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    const row = page.getByRole('row').filter({ hasText: 'Einladung zur ordentlichen Mitgliederversammlung' });
    await expect(row).toContainText('10.02.2026');
    await setE2ESetting(page, 'ui.dateFormat', 'iso');
    await page.goto('/dms');
    await expect(row).toContainText('2026-02-10');
    await row.getByRole('link', { name: 'Einladung zur ordentlichen Mitgliederversammlung' }).click();
    await expect(page.getByTestId('dispatch-panel')).toContainText('2026-02-12');
  });

  test('zeigt die Akte mit Eingangskorb', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(page.getByRole('heading', { name: 'Akte' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Eingangskorb/ })).toBeVisible();
  });

  test('rendert den festgeschriebenen Brief mit dem Branding-Logo', async ({ page }) => {
    // Ersatz für die in Plan 1 entfallene Zusicherung aus documents.spec.ts.
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Mit Logo');
    await page.getByLabel('Text').fill('Text');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    // Anlegen lässt einen im Editor stehen; zum fertigen Dokument führt der Rückweg.
    await page.getByRole('link', { name: 'Zurück zum Dokument' }).click();
    await page.getByRole('button', { name: 'Festschreiben' }).click();
    await page.getByRole('button', { name: 'Festschreiben bestätigen' }).click();
    const response = await page.request.get(await page.getByRole('link', { name: 'PDF öffnen' }).getAttribute('href') ?? '');
    expect(response.headers()['content-type']).toContain('application/pdf');
    expect((await response.body()).byteLength).toBeGreaterThan(1000);
  });

  test('entwirft einen Brief, sieht die Vorschau und schreibt ihn fest', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Einladung zur Mitgliederversammlung');
    await page.getByLabel('Text').fill('Sehr geehrte Mitglieder,\n\nhiermit laden wir ein.');
    await page.getByLabel('Dokumentart').selectOption('letter');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    // Anlegen lässt einen im Editor stehen; zum fertigen Dokument führt der Rückweg.
    await page.getByRole('link', { name: 'Zurück zum Dokument' }).click();
    await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vorschau' })).toBeVisible();
    await page.getByRole('button', { name: 'Festschreiben' }).click();
    await page.getByRole('button', { name: 'Festschreiben bestätigen' }).click();
    await expect(page.getByText(/BRF-\d{4}-\d{3}/)).toBeVisible();
  });

  test('legt eine Datei im Eingangskorb ab und sortiert sie ein', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles({ name: '2026-03-14 Behoerde.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    // Die Dateiwahl ruft `suggestClassification` als Server-Action. Auf dem
    // CI-Läufer wird sie dabei zum ersten Mal übersetzt — die Vorgabe von fünf
    // Sekunden reicht dafür nicht verlässlich, gemessen an zwei von drei roten
    // Läufen am 11.09. Wie beim Publish und beim Scan steht die Frist deshalb
    // ausdrücklich da, statt sich auf die Vorgabe zu verlassen.
    await expect(dialog.getByLabel('Datum auf dem Dokument')).toHaveValue('2026-03-14', { timeout: 30_000 });
    await dialog.getByLabel('Dokumentart').selectOption('authority');
    await dialog.getByLabel('Betreff').fill('Eingegangenes Schreiben');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Eingegangenes Schreiben');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    // Erst auf das Dokument warten, dann die Nummer lesen: Solange der Dialog
    // offen steht, trägt die Liste dahinter ihre Nummern und der Hinweis im
    // Dialog die nächste — zwei Treffer auf dasselbe Muster.
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(page.getByText(/BEH-\d{4}-\d{3}/)).toBeVisible();
  });

  test('dieselbe Datei ein zweites Mal: abgelegt, mit Hinweis und Weg zur ersten (Befund Z)', async ({ page }) => {
    await login(page);
    // Eigene Bytes, damit kein Seed-Dokument dieselbe Prüfsumme trägt.
    const bytes = Buffer.from('%PDF-1.4\n% Befund Z doppelt\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    const numbers: string[] = [];
    for (const name of ['2026-03-14 Rechnung.pdf', '2026-03-14 Rechnung nochmal.pdf']) {
      await page.goto('/dms/receive');
      const dialog = receiveDialog(page);
      await dialog.getByLabel('Datei').setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
      await expect(dialog.getByLabel('Datum auf dem Dokument')).toHaveValue('2026-03-14', { timeout: 30_000 });
      await dialog.getByLabel('Dokumentart').selectOption('authority');
      await dialog.getByLabel('Betreff').fill('Doppelt abgelegt');
      await expect(dialog.getByLabel('Betreff')).toHaveValue('Doppelt abgelegt');
      await dialog.getByRole('button', { name: 'Ablegen' }).click();
      await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
      // Die eigene Nummer nur beim ersten Mal lesen: Beim zweiten nennt der Hinweis die erste.
      if (numbers.length === 0) numbers.push((await page.getByText(/^BEH-\d{4}-\d{3}$/).first().textContent())!.trim());
      else numbers.push(page.url());
    }
    const hint = () => page.getByRole('status').filter({ hasText: 'Dieselbe Datei liegt schon vor als' });
    await expect(hint().getByRole('link', { name: numbers[0] })).toBeVisible();
    await hint().getByRole('link', { name: numbers[0] }).click();
    await expect(page).not.toHaveURL(numbers[1]!);
    // Die erste zeigt den Hinweis in der Gegenrichtung.
    await expect(hint().getByRole('link')).toHaveCount(1);
    await expect(hint().getByRole('link')).not.toHaveText(numbers[0]!);
  });

  test('behält die Eingaben, wenn das Speichern scheitert', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    // Zu langer Betreff: Der Server lehnt ab, der Browser lässt es durch.
    await page.getByLabel('Betreff').fill('x'.repeat(301));
    await page.getByLabel('Text').fill('Mühsam getippter Text, der nicht verloren gehen darf.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();

    await expect(page.locator('#subject-error')).toBeVisible();
    await expect(page.getByLabel('Text')).toHaveValue('Mühsam getippter Text, der nicht verloren gehen darf.');
    await expect(page.getByLabel('Betreff')).toHaveValue('x'.repeat(301));
  });

  test('bessert einen Tippfehler im Entwurf aus, statt ihn wegzuwerfen', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Einladnug zur Versammlung');
    await page.getByLabel('Text').fill('Erster Wurf.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page).toHaveURL(/\/edit$/);

    // Kein Umweg über die Dokumentseite: Der Tippfehler steht noch vor einem.
    await expect(page.getByLabel('Betreff')).toHaveValue('Einladnug zur Versammlung');
    await expect(page.getByLabel('Text')).toHaveValue('Erster Wurf.');

    await page.getByLabel('Betreff').fill('Einladung zur Versammlung');
    await page.getByLabel('Text').fill('Zweiter Wurf.');
    // Der Knopf sagt beim Schreiben mit Vorschau, was er wirklich tut.
    await page.getByRole('button', { name: 'Speichern und Vorschau aktualisieren' }).click();
    await expect(page.getByText(/Vorschau aktuell/)).toBeVisible();

    await page.getByRole('link', { name: 'Zurück zum Dokument' }).click();
    await expect(page.getByRole('heading', { name: 'Einladung zur Versammlung' })).toBeVisible();
    // Immer noch ein Entwurf: keine Nummer, nichts festgeschrieben.
    await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
    await expect(page.getByText(/BRF-\d{4}-\d{3}/)).toHaveCount(0);
  });

  test('bleibt nach dem ersten Speichern dort, wo geschrieben wurde', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Einladnug zur Versammlung');
    await page.getByLabel('Text').fill('Erster Wurf.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();

    // Gespeichert — und der Entwurf steht weiter im Editor, mit dem Blatt daneben.
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByText(/Vorschau aktuell/)).toBeVisible();

    // Der Tippfehler lässt sich sofort ausbessern, ohne einen Weg zurück.
    await page.getByLabel('Betreff').fill('Einladung zur Versammlung');
    await page.getByRole('button', { name: 'Speichern und Vorschau aktualisieren' }).click();
    await expect(page.getByText(/Vorschau aktuell/)).toBeVisible();
    await expect(page.getByLabel('Betreff')).toHaveValue('Einladung zur Versammlung');
  });

  test('füllt mit dem Splitscreen die Höhe des Arbeitsbereichs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);
    await page.goto('/dms/new');

    // Nichts schiebt die Seite über das Fenster hinaus: Gescrollt wird in den
    // Spalten, nicht im Dokument.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Und beide Spalten reichen bis an die Unterkante — dafür ist es ein
    // Splitscreen: links scrollt der Text, rechts steht das Blatt.
    const main = await page.locator('main').boundingBox();
    const preview = await page.locator('[data-slot="preview-pane"]').boundingBox();
    const bar = await page.locator('[data-slot="form-action-bar"]').boundingBox();
    if (!main || !preview || !bar) throw new Error('Bereich, Vorschau oder Leiste nicht sichtbar');
    expect(Math.round(main.y + main.height)).toBe(1000);
    expect(Math.round(preview.y + preview.height)).toBe(1000);
    // Die Speicherleiste steht am unteren Rand der Spalte, nicht unter der Karte.
    expect(Math.round(bar.y + bar.height)).toBe(1000);
  });

  test('lässt den Hinweis zur festen Art über die Zeile laufen, statt ein Loch zu reissen', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Mit festem Typ');
    await page.getByLabel('Text').fill('Text.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page).toHaveURL(/\/edit$/);

    const hint = page.getByText(/Die Dokumentart steht seit dem Anlegen fest/);
    // Die Zeile darüber ist Art · Datum (HANDOFF Konsistenz § 8c): Der Hinweis beginnt unter „Art“.
    const type = page.locator('#typeKey');
    const date = page.getByLabel('Datum auf dem Dokument');
    const hintBox = await hint.boundingBox();
    const typeBox = await type.boundingBox();
    const dateBox = await date.boundingBox();
    if (!hintBox || !typeBox || !dateBox) throw new Error('Hinweis oder Feld nicht sichtbar');

    // Über beide Spalten statt in einer Zelle: Sonst steht neben „Art“ ein
    // Loch, und die vier Felder lesen sich als zwei lose Paare.
    expect(hintBox.width).toBeGreaterThan(dateBox.width * 1.5);
    expect(Math.round(hintBox.x)).toBe(Math.round(typeBox.x));
    expect(hintBox.y).toBeGreaterThan(dateBox.y);
  });

  test('teilt den Splitscreen mit dem Fenster, statt die Spalte festzunageln', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await login(page);
    await page.goto('/dms/new');

    const main = await page.locator('main').boundingBox();
    const column = await page.locator('[data-slot="form-column"]').boundingBox();
    if (!main || !column) throw new Error('Bereich oder Spalte nicht sichtbar');

    // Ein Viertel war es vorher: Die 560 px stammen aus einem 1220-px-Entwurf
    // und liessen den Teil, in dem gearbeitet wird, mit jedem Zoll schrumpfen.
    expect(column.width / main.width).toBeGreaterThan(0.3);
    expect(column.width).toBeLessThanOrEqual(760);
    expect(column.width).toBeGreaterThanOrEqual(520);
  });

  test('gibt die übrige Höhe der Spalte dem Schreibfeld', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);
    await page.goto('/dms/new');

    const card = await page.locator('[data-slot="form-card"]').boundingBox();
    const bar = await page.locator('[data-slot="form-action-bar"]').boundingBox();
    const text = await page.getByLabel('Text').boundingBox();
    if (!card || !bar || !text) throw new Error('Karte, Leiste oder Feld nicht sichtbar');

    // Keine tote Spalte mehr zwischen Karte und Leiste …
    expect(bar.y - (card.y + card.height)).toBeLessThan(60);
    // … und der Platz geht dorthin, wo der Brief entsteht.
    expect(text.height).toBeGreaterThan(300);
  });

  test('nennt im Vorschaukopf, wie viele Seiten das Schreiben hat', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Kurzes Schreiben');
    await page.getByLabel('Text').fill('Ein Absatz, mehr nicht.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page).toHaveURL(/\/edit$/);

    const header = page.locator('[data-slot="preview-pane"]');
    await expect(header).toContainText('1 Seite', { timeout: 30_000 });

    // Gezählt wird wirklich: Mehr Text, mehr Seiten.
    await page.getByLabel('Text').fill('Sehr geehrte Mitglieder,\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(200));
    await page.getByRole('button', { name: 'Speichern und Vorschau aktualisieren' }).click();
    await expect(header).toContainText(/[2-9] Seiten/, { timeout: 30_000 });
  });

  test('lässt die Speicherleiste durch die ganze Spalte laufen', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');

    const card = page.locator('[data-slot="form-card"]');
    const bar = page.locator('[data-slot="form-action-bar"]');
    const cardBox = await card.boundingBox();
    const barBox = await bar.boundingBox();
    if (!cardBox || !barBox) throw new Error('Karte oder Leiste nicht sichtbar');

    // Die Karte steht eingerückt in der Spalte; die Leiste läuft darunter durch.
    expect(barBox.x).toBeLessThan(cardBox.x);
    expect(barBox.x + barBox.width).toBeGreaterThan(cardBox.x + cardBox.width);
  });

  test('zeigt den Entwurf neben dem Papier, auf dem er landet', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');

    // Solange nichts gespeichert ist, gibt es nichts zu zeigen — und die
    // Vorschau sagt das, statt ein leeres Blatt zu behaupten.
    await expect(page.getByText('Die Vorschau entsteht beim ersten Speichern.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'PDF öffnen' })).toHaveCount(0);

    await page.getByLabel('Betreff').fill('Einladung');
    await page.getByLabel('Text').fill('Sehr geehrte Mitglieder,');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();

    await expect(page.getByText(/Vorschau aktuell/)).toBeVisible();
    await expect(page.locator('iframe')).toBeVisible();

    // Das Blatt in gross: als Verweis, damit auch die mittlere Maustaste trägt.
    const openPdf = page.getByRole('link', { name: 'PDF öffnen' });
    await expect(openPdf).toHaveAttribute('target', '_blank');
    await expect(openPdf).toHaveAttribute('href', /\/preview/);

    // Eine Änderung veraltet die Vorschau, und der Knopf sagt, was er tun wird.
    await page.getByLabel('Betreff').fill('Einladung zur Versammlung');
    await expect(page.getByText(/Vorschau veraltet/)).toBeVisible();
    await page.getByRole('button', { name: 'Speichern und Vorschau aktualisieren' }).click();

    // Gespeichert wird, ohne den Bildschirm zu verlassen.
    await expect(page.getByText(/Vorschau aktuell/)).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel('Betreff')).toHaveValue('Einladung zur Versammlung');
  });

  test('lässt das Datum des Schreibens setzen und später ausbessern', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Auf ein bestimmtes Datum');
    await page.getByLabel('Text').fill('Text.');
    await page.getByLabel('Datum auf dem Dokument').fill('2026-04-01');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel('Datum auf dem Dokument')).toHaveValue('2026-04-01');
    await page.getByLabel('Datum auf dem Dokument').fill('2026-05-02');
    await page.getByRole('button', { name: 'Speichern und Vorschau aktualisieren' }).click();
    await expect(page.getByText(/Vorschau aktuell/)).toBeVisible();
    await page.getByRole('link', { name: 'Zurück zum Dokument' }).click();
    await expect(page.getByText('02.05.2026')).toBeVisible();
  });

  test('nennt den Bezug beim Namen, nicht beim Entitätstyp', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Brief mit Empfänger');
    await page.getByLabel('Text').fill('Text.');
    // Der erste echte Kontakt aus dem Seed, wer immer es ist.
    const recipient = page.getByRole('combobox', { name: 'Empfänger' });
    await recipient.click();
    const firstOption = page.getByTestId('contact-option').first();
    await expect(firstOption).toBeVisible();
    await expect(firstOption).toBeVisible();
    // Der Treffer zeigt Name und Ort; erwartet wird nur der Name.
    const name = (await firstOption.getAttribute('data-name'))?.trim() ?? '';
    expect(name.length).toBeGreaterThan(0);
    await firstOption.click();
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    // Anlegen lässt einen im Editor stehen; zum fertigen Dokument führt der Rückweg.
    await page.getByRole('link', { name: 'Zurück zum Dokument' }).click();

    const links = page.getByTestId('document-links');
    await expect(links).toContainText(name);
    await expect(links).toContainText('Empfänger');
    // Die rohen Bezeichner haben auf dem Bildschirm nichts verloren.
    await expect(links).not.toContainText('contact');
    await expect(links).not.toContainText('recipient');
  });

  test('bietet für ein festgeschriebenes Dokument kein Bearbeiten an', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Fest und fertig');
    await page.getByLabel('Text').fill('Text.');
    await page.getByLabel('Dokumentart').selectOption('letter');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    // Anlegen lässt einen im Editor stehen; zum fertigen Dokument führt der Rückweg.
    await page.getByRole('link', { name: 'Zurück zum Dokument' }).click();
    await page.getByRole('button', { name: 'Festschreiben' }).click();
    await page.getByRole('button', { name: 'Festschreiben bestätigen' }).click();
    await expect(page.getByText(/BRF-\d{4}-\d{3}/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bearbeiten' })).toHaveCount(0);
  });

  test('nennt den Grund am Feld, statt auf Markierungen zu verweisen, die es nicht gibt', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('Text, kein PDF.') });
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-03-01');
    await dialog.getByLabel('Betreff').fill('Falscher Dateityp');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Falscher Dateityp');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByText('Nur PDF. Schriftverkehr wird als PDF abgelegt, damit er in zehn Jahren noch lesbar ist.')).toBeVisible();
    // Der allgemeine Kasten verweist nur dann auf Markierungen, wenn es welche gibt.
    await expect(page.getByText('Bitte prüfen Sie die markierten Felder.')).toHaveCount(0);
  });

  test('löscht ein Dokument, dessen Aufbewahrungsfrist abgelaufen ist', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles({ name: 'Alte Rechnung.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await dialog.getByLabel('Dokumentart').selectOption('invoice');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2005-06-01');
    await dialog.getByLabel('Betreff').fill('Abgelaufene Rechnung');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Abgelaufene Rechnung');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(page.getByText(/RCH-\d{4}-\d{3}/)).toBeVisible();

    // Der Fristenbildschirm führt auf genau dieses Dokument.
    await page.goto('/admin/retention');
    await expect(page.getByRole('heading', { name: 'Dokumente' })).toBeVisible();
    await page.getByRole('link', { name: /Dokument RCH-/ }).click();

    await page.getByRole('button', { name: 'Endgültig löschen' }).click();
    await page.getByRole('button', { name: 'Löschung bestätigen' }).click();
    await expect(page).toHaveURL(/\/dms$/);
    await expect(page.getByText('Abgelaufene Rechnung')).toHaveCount(0);
  });

  test('lässt ein Dokument in laufender Frist nicht löschen', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles({ name: 'Neue Rechnung.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await dialog.getByLabel('Dokumentart').selectOption('invoice');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-03-01');
    await dialog.getByLabel('Betreff').fill('Laufende Rechnung');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Laufende Rechnung');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByRole('button', { name: 'Endgültig löschen' })).toBeDisabled();
  });

  test('verwaltet Dokumentarten und Regeln', async ({ page }) => {
    await login(page);
    // Über die Navigation, nicht über die URL: Der Bildschirm war gebaut und
    // fertig, nur zeigte nichts darauf.
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' }).click();
    await page.getByRole('navigation', { name: 'Unternavigation' }).getByRole('link', { name: 'Akte', exact: true }).click();
    const tabs = page.getByRole('navigation', { name: 'Bereiche der Akte' });
    await expect(tabs.getByRole('link', { name: 'Arten' })).toHaveAttribute('aria-current', 'page');
    // Der Bereich steht im Reiter, nicht noch einmal als Überschrift darunter.
    await expect(page.getByText('Verwalten Sie die Dokumentarten')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dokumentarten' })).toHaveCount(0);
    await tabs.getByRole('link', { name: 'Regeln' }).click();
    await expect(page.getByText('Automatische Erkennung und Zuordnung')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Einsortierregeln' })).toHaveCount(0);
    await tabs.getByRole('link', { name: 'Ordner' }).click();
    await expect(page.getByTestId('folders-moved')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ordner' })).toHaveCount(0);
    // Ein altes Lesezeichen mit unbekanntem Bereich zeigt den ersten, keine leere Seite.
    await page.goto('/admin/dms?panel=quatsch');
    await expect(tabs.getByRole('link', { name: 'Arten' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Verwalten Sie die Dokumentarten')).toBeVisible();
  });

  /**
   * Die Texterkennung im Image, von der Datei bis zum Treffer: poppler liest,
   * der Worker indiziert, die Suche findet über den Inhalt. Gelesen wird das
   * Beispiel aus dem Seed — nicht ein eben abgelegtes Schreiben. Bis
   * 2026-09-16 legte der Test es selbst über den Dialog ab, und dessen
   * Betreff-Feld verschluckt unter Last gelegentlich das `fill`
   * (Mechanismus C): Dann wartete dieser Test zwei Minuten auf eine
   * Texterkennung, die nie etwas zu lesen bekam. Das Ablegen prüfen die Tests
   * des Dialogs.
   */
  test('ein Schreiben wird gelesen und über seinen Inhalt gefunden', async ({ page }) => {
    test.setTimeout(150_000);
    await login(page);

    // „Tierschutzes“ steht nur im Text des Freistellungsbescheids, nicht im
    // Betreff. Der Worker liest die Seed-Dokumente nach dem Reset im
    // Hintergrund; gewartet wird auf den Treffer, nicht auf eine feste Zeit.
    await expect(async () => {
      await page.goto('/dms');
      await page.getByPlaceholder('Betreff, Nummer oder Inhalt').fill('tierschutzes');
      await expect(page.getByText('Freistellungsbescheid')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000 });

    const previewLink = page.getByRole('link', { name: /Seite 1/ });
    await expect(previewLink).toBeVisible();
    await expect(previewLink).toHaveAttribute('href', /\/dms\/.+\/preview#page=1/);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      previewLink.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    await page.getByText('Freistellungsbescheid').click();
    await expect(page.getByText(/Gelesen am/)).toBeVisible();
  });

  test('zeigt die Ordner mit ihrem Bestand neben der Liste', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await expect(page.getByRole('link', { name: /Eingangskorb/ })).toBeVisible();
    const folders = folderTree(page);
    await expect(folders.getByRole('treeitem', { name: 'protokolle' })).toBeVisible();

    // Unterordner stehen mit ihrem Namen unter dem Elternordner, erst nach dem Aufklappen.
    await expect(folders.getByRole('treeitem', { name: 'finanzamt' })).toHaveCount(0);
    await expandFolder(page, 'behoerden');
    await expect(folders.getByRole('treeitem', { name: 'finanzamt' })).toHaveAttribute('aria-level', '2');

    // Ein Klick filtert die Liste auf diesen Ordner, und der Ordner ist gewählt.
    await folders.getByRole('treeitem', { name: 'protokolle' }).click();
    await expect(page).toHaveURL(/folder=protokolle/);
    await expect(folders.getByRole('treeitem', { name: 'protokolle' })).toHaveAttribute('aria-current', 'page');
  });

  test('klappt Ordner mit den Pfeiltasten auf und zu, und der Weg zum gewählten ist offen', async ({ page }) => {
    await login(page);
    await page.goto('/dms?folder=behoerden%2Ffinanzamt');

    const folders = folderTree(page);
    const row = (name: string) => folders.getByRole('treeitem', { name: new RegExp(`^${name},`) });
    const behoerden = row('behoerden');
    const amtsgericht = row('amtsgericht');
    await expect(behoerden).toHaveAttribute('aria-expanded', 'true');
    await expect(row('finanzamt')).toHaveAttribute('aria-current', 'page');

    // Mit Tab vom Eingangskorb in den Baum: Der gewählte Ordner hat den Fokus.
    await page.getByRole('link', { name: /Eingangskorb/ }).focus();
    await page.keyboard.press('Tab');
    await expect(row('finanzamt')).toBeFocused();

    await page.keyboard.press('ArrowUp');
    await expect(amtsgericht).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(amtsgericht).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(amtsgericht).toHaveAttribute('aria-expanded', 'false');

    // Der Weg zum gewählten Ordner bleibt offen (README § 5).
    await page.keyboard.press('ArrowUp');
    await expect(behoerden).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(behoerden).toHaveAttribute('aria-expanded', 'true');

    // Enter öffnet den Ordner, obwohl die Zeile selbst kein Link ist.
    await page.keyboard.press('ArrowDown');
    await expect(amtsgericht).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/folder=behoerden%2Famtsgericht/);
  });

  test('stellt die Kopfknöpfe auf Feldhöhe und den primären nach rechts', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    const receive = page.getByRole('button', { name: 'Post ablegen' });
    const draft = page.getByRole('link', { name: 'Neuer Entwurf' });
    const receiveBox = await receive.boundingBox();
    const draftBox = await draft.boundingBox();
    if (!receiveBox || !draftBox) throw new Error('Knöpfe nicht sichtbar');

    // Hauptwege des Bildschirms, keine Nebenaktionen — und daneben steht ein
    // 38-px-Suchfeld.
    expect(Math.round(receiveBox.height)).toBe(38);
    expect(Math.round(draftBox.height)).toBe(38);

    // Der primäre Knopf schliesst die Gruppe ab.
    expect(draftBox.x).toBeGreaterThan(receiveBox.x);
  });

  test('hält die Zeilenhöhe des Fundaments ein', async ({ page }) => {
    await login(page);
    // Lange Betreffs, Arten und Orte brechen um, damit die Spalte „Ordner“
    // ohne Querscrollen sichtbar bleibt (Spec § 9); solche Zeilen werden
    // höher. Eine einzeilige Zeile hat die Höhe des Fundaments.
    await page.goto('/dms?folder=vertraege');
    const row = page.getByRole('row', { name: /Mietvertrag Lagerraum/ });
    const box = await row.boundingBox();
    if (!box) throw new Error('Zeile nicht sichtbar');
    expect(Math.round(box.height)).toBe(44);
  });

  test('richtet die Liste auf das Überfliegen aus', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    // Datum wie Nummer: Zahlen, die man untereinander vergleicht, stehen in
    // Monospace — das ist der Zweck der Spalte.
    const date = page.getByRole('cell', { name: '15.02.2026' });
    expect(await date.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Plex');

    // Die ganze Zeile führt zum Dokument; ein fester Unterstrich am Betreff
    // bietet einen zweiten Weg an, den es nicht gibt.
    const subject = page.getByRole('link', { name: 'Freistellungsbescheid' });
    expect(await subject.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');

    // Der Entwurf steht beim Betreff, nicht nur am rechten Rand.
    const draftRow = page.getByRole('row', { name: /Protokoll Vorstandssitzung/ });
    // Spalte 0 ist das Kästchen der Auswahl.
    await expect(draftRow.getByRole('cell').nth(2)).toContainText('Entwurf');
  });

  test('führt die Ordnerspalte bis zum unteren Rand der Fläche', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    // Gegen den Arbeitsbereich gemessen, nicht gegen die Zeilen: Bei wenigen
    // Ordnern wäre die Spalte sonst das höchste Element und die Prüfung ginge
    // aus dem falschen Grund durch.
    const main = page.locator('main');
    const column = page.getByTestId('folder-column');
    const mainBox = await main.boundingBox();
    const columnBox = await column.boundingBox();
    if (!mainBox || !columnBox) throw new Error('Bereich oder Spalte nicht sichtbar');

    // Beim Ziehen ist die Spalte die helle Fläche gegen das abgedunkelte Feld
    // daneben. Endet sie vorher, sieht darunter Overlay aus wie Spalte.
    expect(columnBox.y + columnBox.height).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 1);
  });

  test('zieht eine Datei auf einen Ordner und legt sie dorthin', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expandFolder(page, 'behoerden');

    await dropFiles(page, '[data-folder="behoerden/finanzamt"]', ['Bescheid der Stadtkasse.pdf']);

    const dialog = receiveDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Bescheid der Stadtkasse.pdf')).toBeVisible();
    await expectFolder(dialog, 'behoerden/finanzamt', 'behoerden › finanzamt');
    await expect(dialog.getByText('hierauf gezogen')).toBeVisible();

    // „Ändern…“ wählt im Baum einen anderen Ordner, und abgelegt wird dort.
    await dialog.getByRole('button', { name: 'Ändern…' }).click();
    const pick = page.getByRole('dialog', { name: 'Ordner wählen' });
    await pick.getByRole('treeitem', { name: /^protokolle,/ }).click();
    await pick.getByRole('button', { name: '„protokolle“ übernehmen' }).click();
    await expect(pick).toHaveCount(0);
    await expectFolder(dialog, 'protokolle', 'protokolle');
    await expect(dialog.getByText('hierauf gezogen')).toHaveCount(0);

    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-05-01');
    await dialog.getByLabel('Betreff').fill('Bescheid der Stadtkasse');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Bescheid der Stadtkasse');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(page.locator('[data-folder-path]')).toHaveText('protokolle');
  });

  /**
   * Review Focus 5 (Plan 3): Zwischen Öffnen und Ablegen benennt jemand den
   * Ordner um. Der Grund steht am Ordnerfeld, und was getippt war, bleibt.
   */
  test('nennt am Ordnerfeld, dass der Ordner inzwischen anders heißt, und behält die Eingaben', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expandFolder(page, 'behoerden');
    await dropFiles(page, '[data-folder="behoerden/finanzamt"]', ['Grundsteuer.pdf']);

    const dialog = receiveDialog(page);
    await expectFolder(dialog, 'behoerden/finanzamt', 'behoerden › finanzamt');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-05-01');
    await dialog.getByLabel('Dokumentart').selectOption('authority');
    await dialog.getByLabel('Betreff').fill('Bescheid zur Grundsteuer');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Bescheid zur Grundsteuer');

    await renameFolderElsewhere(page, 'behoerden/finanzamt', 'steueramt');

    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(dialog.locator('#folder-error')).toHaveText('Den Ordner „finanzamt“ gibt es nicht mehr. Wählen Sie einen anderen.');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Bescheid zur Grundsteuer');
    await expect(dialog.getByLabel('Dokumentart')).toHaveValue('authority');
    await expect(dialog.getByText('Grundsteuer.pdf')).toBeVisible();
  });

  test('nennt beim Ablegen jede gezogene Datei, die kein PDF ist', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await dropFiles(page, '[data-folder="vertraege"]', ['Vertrag.pdf', 'notiz.txt']);

    const dialog = receiveDialog(page);
    await expect(dialog.getByText('„notiz.txt“ ist kein PDF und wurde nicht übernommen. Die Akte nimmt nur PDF.')).toBeVisible();
    await expect(dialog.getByText('Vertrag.pdf')).toBeVisible();
  });

  test('nennt beim Ziehen über einem Ordner das Ziel, über der Liste den Eingangskorb', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expandFolder(page, 'behoerden');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      for (const name of ['Eins.pdf', 'Zwei.pdf']) transfer.items.add(new File(['%PDF-1.4'], name, { type: 'application/pdf' }));
      const row = document.querySelector('[data-folder="behoerden/finanzamt"]')!;
      for (const type of ['dragenter', 'dragover']) row.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByText('2 Dateien in „finanzamt“ ablegen', { exact: true })).toBeVisible();
    await expect(page.getByText('Die Akte nimmt nur PDF. Hier loslassen legt in den Eingangskorb.', { exact: true })).toBeVisible();

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['%PDF-1.4'], 'Eins.pdf', { type: 'application/pdf' }));
      document.querySelector('main')!.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByText('2 Dateien ablegen', { exact: true })).toBeVisible();
  });

  /**
   * Der Baum nimmt die Datei an, und das Fenster hört ebenfalls auf `drop`
   * (Eingangskorb). Feuerten beide, gewönne das Fenster, weil es zuletzt
   * hört: Der Dialog stünde dann auf dem Eingangskorb statt auf dem Ordner.
   */
  test('eine Datei auf einem Ordner öffnet genau einen Empfangsdialog', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await dropFiles(page, '[data-folder="protokolle"]', ['Protokoll.pdf']);

    const dialog = receiveDialog(page);
    await expect(dialog).toHaveCount(1);
    await expectFolder(dialog, 'protokolle', 'protokolle');
    await expect(dialog.getByText('1 von')).toHaveCount(0);
  });

  test('eine Datei irgendwo im Fenster landet im Eingangskorb', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await dropFiles(page, 'main', ['Ohne Ziel.pdf']);

    const dialog = receiveDialog(page);
    await expect(dialog).toBeVisible();
    await expectFolder(dialog, '', 'Eingangskorb');
  });

  /**
   * Zwischen oder unter den Zeilen des Baums ist kein Ordner. Früher schluckte
   * der Baum die Datei dort still (er nahm sie an, die Wurzel lehnte ab, und
   * das Fenster sah weg, weil das Ziel im Baum lag).
   */
  test('eine Datei neben die Ordnerzeilen landet im Eingangskorb', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(folderTree(page).getByRole('treeitem').first()).toBeVisible();

    await dropFiles(page, '[role="tree"]', ['Neben dem Baum.pdf']);

    const dialog = receiveDialog(page);
    await expect(dialog).toBeVisible();
    await expectFolder(dialog, '', 'Eingangskorb');
  });

  test('nennt beim Ziehen die Zahl der Dateien, wenn der Browser sie kennt', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      for (const name of ['Eins.pdf', 'Zwei.pdf']) transfer.items.add(new File(['%PDF-1.4'], name, { type: 'application/pdf' }));
      document.querySelector('main')!.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });

    await expect(page.getByText('2 Dateien ablegen', { exact: true })).toBeVisible();
  });

  /**
   * Safari verrät beim Ziehen aus dem Finder nur, dass Dateien kommen, nicht wie
   * viele: `types` enthält „Files“, `items` ist leer, erst `drop` bringt die
   * Dateien. Das Overlay behauptete deshalb „0 Dateien ablegen“ (2026-09-19).
   */
  test('behauptet beim Ziehen in Safari keine Zahl und nimmt die Dateien trotzdem an', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();

    await page.evaluate(() => {
      const event = new DragEvent('dragenter', { bubbles: true, cancelable: true });
      const hidden = { types: ['Files'], items: { length: 0 }, files: { length: 0 } };
      Object.defineProperty(event, 'dataTransfer', { value: hidden });
      document.querySelector('main')!.dispatchEvent(event);
    });

    await expect(page.getByText('Dateien ablegen', { exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ Dateien? ablegen/)).toHaveCount(0);

    await dropFiles(page, 'main', ['Aus Safari.pdf']);
    const dialog = receiveDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Aus Safari.pdf')).toBeVisible();
  });

  /**
   * Nimmt der Baum ein Ablegen entgegen und kommt keine Datei an (oder lehnt er
   * das Ziel ab), stoppt er das Ereignis; die Ablagefläche blieb stehen.
   */
  test('die Ablagefläche verschwindet auch, wenn der Baum das Ablegen schluckt', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();
    await expect(page.locator('[data-folder="vertraege"]')).toBeAttached();

    await page.evaluate(() => {
      const hidden = { types: ['Files'], items: { length: 0 }, files: { length: 0 } };
      for (const [type, target] of [['dragenter', 'main'], ['drop', '[data-folder="vertraege"]']] as const) {
        const event = new DragEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: hidden });
        document.querySelector(target)!.dispatchEvent(event);
      }
    });

    await expect(page.getByText('Dateien ablegen', { exact: true })).toHaveCount(0);
    await expect(receiveDialog(page)).toHaveCount(0);
  });

  test('arbeitet mehrere gezogene Dateien der Reihe nach ab', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await dropFiles(page, '[data-folder="vertraege"]', ['Erster Vertrag.pdf', 'Zweiter Vertrag.pdf']);
    const dialog = receiveDialog(page);

    await expect(dialog.getByText('1 von 2')).toBeVisible();
    await expect(dialog.getByText('Erster Vertrag.pdf')).toBeVisible();
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-05-01');
    await dialog.getByLabel('Betreff').fill('Erster Vertrag');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Erster Vertrag');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();

    // Die nächste Datei steht schon da; der Ordner, auf den gezogen wurde, bleibt.
    await expect(dialog.getByText('2 von 2')).toBeVisible();
    await expect(dialog.getByText('Zweiter Vertrag.pdf')).toBeVisible();
    await expectFolder(dialog, 'vertraege', 'vertraege');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-05-02');
    await dialog.getByLabel('Betreff').fill('Zweiter Vertrag');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Zweiter Vertrag');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();

    // Nach der letzten schliesst der Dialog, und beide stehen in der Liste.
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Erster Vertrag' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Zweiter Vertrag' })).toBeVisible();
  });

  test('fragt nach, bevor der Rest einer angefangenen Warteschlange verfällt', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await dropFiles(page, '[data-folder="vertraege"]', ['Eins.pdf', 'Zwei.pdf']);
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-05-01');
    await dialog.getByLabel('Betreff').fill('Eins');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Eins');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(dialog.getByText('2 von 2')).toBeVisible();

    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    const ask = page.getByRole('alertdialog');
    await expect(ask).toContainText('Warteschlange verwerfen?');
    await expect(ask).toContainText('Eine Datei ist noch nicht abgelegt.');
    await ask.getByRole('button', { name: 'Verwerfen' }).click();

    await expect(dialog).toHaveCount(0);
    // Was abgelegt wurde, bleibt abgelegt.
    await expect(page.getByRole('link', { name: 'Eins', exact: true })).toBeVisible();
  });

  test('sagt im Dialog, welche Nummer beim Ablegen gezogen wird', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);

    await dialog.getByLabel('Dokumentart').selectOption('authority');
    await expect(dialog.getByText(/Die Nummer BEH-\d{4}-\d{3} wird beim Ablegen gezogen/)).toBeVisible();

    // Eine andere Art, ein anderer Nummernkreis.
    await dialog.getByLabel('Dokumentart').selectOption('invoice');
    await expect(dialog.getByText(/Die Nummer RCH-\d{4}-\d{3} wird beim Ablegen gezogen/)).toBeVisible();
  });

  test('sagt am vorbelegten Feld, woher der Vorschlag kommt', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);

    await dialog.getByLabel('Datei').setInputFiles({
      name: '2026-03-14 Finanzamt Bescheid.pdf',
      mimeType: 'application/pdf',
      buffer: samplePdf(),
    });

    await expect(dialog.getByLabel('Datum auf dem Dokument')).toHaveValue('2026-03-14');
    await expect(dialog.getByText('aus dem Dateinamen')).toBeVisible();
    // Die Regel hat Art und Ordner belegt; beide sagen es.
    await expect(dialog.getByText('Regel: „Finanzamt“ im Namen')).toHaveCount(2);

    // Wer das Feld anfasst, hat es selbst in der Hand — die Herkunft verschwindet.
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-04-01');
    await expect(dialog.getByText('aus dem Dateinamen')).toHaveCount(0);
    await expect(dialog.getByText('Regel: „Finanzamt“ im Namen')).toHaveCount(2);
  });

  test('legt Post in einem Dialog über der Liste ab, statt die Liste zu verlassen', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await page.getByRole('button', { name: 'Post ablegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Post ablegen' });
    await expect(dialog).toBeVisible();
    // Die Liste bleibt stehen, wo sie war.
    await expect(page.locator('table')).toBeVisible();

    // Zwei Wege hinaus, nicht drei: „Abbrechen“ wirft im Dialog ohnehin alles
    // weg — „Verwerfen“ wäre derselbe Vorgang unter zweitem Namen.
    await expect(dialog.getByRole('button', { name: 'Verwerfen' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/dms$/);
  });

  test('der Deep-Link auf das Ablegen zeigt denselben Dialog über derselben Liste', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);

    await expect(page.getByRole('dialog', { name: 'Post ablegen' })).toBeVisible();
    // Nicht über die Rolle: Der Dialog nimmt die Liste aus dem Baum für
    // Vorlesesoftware — stehen bleibt sie trotzdem.
    await expect(page.locator('table')).toBeVisible();
  });

  test('nimmt die Datei auf einer Ablagefläche an und zeigt danach ihre Karte', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);

    await expect(dialog.getByText('PDF hierher ziehen')).toBeVisible();
    await expect(dialog.getByText('Nur PDF, höchstens 10 MB.')).toBeVisible();

    // Unterstrichen ist, was klickt — nicht der Satz drumherum.
    const pick = dialog.getByRole('button', { name: 'Datei auswählen' });
    expect(await pick.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline');
    const around = dialog.getByText(/^oder Datei auswählen$/);
    expect(await around.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
    // Ohne Datei gäbe „Ablegen“ ein Versprechen, das ins Leere greift.
    await expect(dialog.getByRole('button', { name: 'Ablegen' })).toBeDisabled();

    await dialog.getByLabel('Datei').setInputFiles({
      name: 'Stadtkasse Bescheid.pdf',
      mimeType: 'application/pdf',
      buffer: samplePdf(),
    });

    // Aus der Fläche wird die Karte: Name, Grösse und was als Nächstes passiert.
    await expect(dialog.getByText('Stadtkasse Bescheid.pdf')).toBeVisible();
    await expect(dialog.getByText(/^PDF · \d/)).toBeVisible();
    await expect(dialog.getByText('Texterkennung läuft nach dem Ablegen.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ansehen' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ersetzen' })).toBeVisible();
    await expect(dialog.getByText('PDF hierher ziehen')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Ablegen' })).toBeEnabled();
  });

  test('ein zu kurzer Begriff sagt, warum er nichts findet', async ({ page }) => {
    await login(page);

    await page.goto('/dms');
    await page.getByPlaceholder('Betreff, Nummer oder Inhalt').fill('ab');

    await expect(page.getByText(/mindestens drei Zeichen/)).toBeVisible();
  });

  test('ein Klick auf den Spaltenkopf dreht die Reihenfolge, und die URL trägt sie', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('button', { name: 'Sortieren nach Betreff' }).click();
    await expect(page).toHaveURL(/sort=subject&dir=desc/);
    const first = await page.getByRole('row').nth(1).getByRole('link').first().textContent();
    await page.getByRole('button', { name: 'Sortieren nach Betreff' }).click();
    await expect(page).toHaveURL(/dir=asc/);
    const afterFlip = await page.getByRole('row').nth(1).getByRole('link').first().textContent();
    expect(afterFlip).not.toBe(first);
    await page.reload();
    await expect(page.getByRole('columnheader', { name: /Betreff/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  test('legt aus dem Entwurf heraus einen neuen Kontakt an und wählt ihn als Empfänger', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    const picker = page.getByRole('combobox', { name: 'Empfänger' });
    await picker.click();
    await page.getByRole('listbox').getByRole('option', { name: 'Neu anlegen …' }).click();
    const dialog = page.getByRole('dialog', { name: 'Kontakt anlegen' });
    await dialog.getByLabel('Nachname').fill('Neuland');
    await dialog.getByLabel('Vorname').fill('Nora');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect(dialog).toBeHidden();
    await expect(picker).toHaveValue('Nora Neuland');
    await page.getByLabel('Betreff').fill('An Nora');
    await page.getByLabel('Text').fill('Hallo');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}\/edit$/);
    await expect(page.getByRole('combobox', { name: 'Empfänger' })).toHaveValue('Nora Neuland');
  });

  /**
   * Ein Mausklick ist kein Augenblick: Zwischen Drücken und Loslassen liegen
   * bei einem Menschen leicht 150 ms. Das Drücken nimmt dem Feld den Fokus;
   * schließt die Liste daraufhin, bevor die Maus losgelassen wird, trifft der
   * Klick ins Leere. Enter funktionierte, weil die Tastatur den Fokus nicht
   * bewegt — genau der Befund vom 2026-09-12.
   */
  test('wählt einen Kontakt auch mit einem langsamen Mausklick', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    const picker = page.getByRole('combobox', { name: 'Empfänger' });
    await picker.fill('Mus');
    const option = page.getByTestId('contact-option').first();
    await expect(option).toBeVisible();
    await option.scrollIntoViewIfNeeded();
    // Erst, wenn die Schriften da sind: Im kalten Server kommen sie spät, und
    // ein Layout, das sich unter der gedrückten Maus verschiebt, lässt den
    // Klick daneben landen — das wäre dann der Test, nicht die Anwendung.
    await page.evaluate(() => document.fonts.ready);
    const box = (await option.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect(page.locator('input[name="recipientId"]')).not.toHaveValue('');
    await expect(picker).not.toHaveValue('Mus');
  });

  test('öffnet „Neu anlegen“ auch mit einem langsamen Mausklick', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    const picker = page.getByRole('combobox', { name: 'Empfänger' });
    await picker.click();
    const create = page.getByRole('listbox').getByRole('option', { name: 'Neu anlegen …' });
    await expect(create).toBeVisible();
    // Der Eintrag steht am Ende der Liste und damit im 800-px-Fenster unter
    // der Kante; ein Mensch scrollt, bevor er klickt.
    await create.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const box = (await create.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Kontakt anlegen' })).toBeVisible();
  });

  test('öffnet „Neu anlegen“ auch aus dem Ablegen-Dialog heraus mit langsamem Klick', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);
    await dialog.getByRole('combobox', { name: 'Absender' }).click();
    const create = dialog.getByRole('listbox').getByRole('option', { name: 'Neu anlegen …' });
    await expect(create).toBeVisible();
    await create.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const box = (await create.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Kontakt anlegen' })).toBeVisible();
    // Der Ablegen-Dialog bleibt darunter stehen — solange der obere offen ist,
    // ist er für Hilfstechnik verborgen, danach wieder da.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Kontakt anlegen' })).toBeHidden();
    await expect(dialog).toBeVisible();
  });

  test('findet einen Kontakt über das Suchfeld', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    const picker = page.getByRole('combobox', { name: 'Empfänger' });
    await picker.fill('Mus');
    // Nur echte Kontakte, nicht „Neu anlegen …“ — das steht schon da, bevor die
    // Suche geantwortet hat.
    const options = page.getByTestId('contact-option');
    await expect(options.first()).toBeVisible();
    await options.first().click();
    await expect(page.locator('input[name="recipientId"]')).not.toHaveValue('');
  });

  test('holt ein Dokument aus dem Eingangskorb in einen Ordner', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    const row = page.getByRole('row').nth(1);
    const subject = (await row.getByRole('cell').nth(2).textContent())?.trim() ?? '';
    expect(subject.length).toBeGreaterThan(0);
    await row.click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    // Der Ort als Weg und „Verschieben nach…“ statt Auswahlliste und „Speichern“ (Artboard 5).
    const place = page.locator('[data-folder-path]');
    await expect(place).toHaveText('Eingangskorb');
    await page.getByRole('button', { name: 'Verschieben nach…' }).click();
    const dialog = page.getByRole('dialog', { name: `„${subject}“ verschieben nach…` });
    await expect(dialog.getByText('Liegt im Eingangskorb.')).toBeVisible();
    await dialog.getByRole('treeitem', { name: /^behoerden,/ }).locator('[data-toggle]').click();
    await dialog.getByRole('treeitem', { name: /^finanzamt,/ }).click();
    await dialog.getByRole('button', { name: 'Nach „finanzamt“ verschieben' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(place).toHaveText('behoerden › finanzamt');
    await expect(place.getByRole('link', { name: 'finanzamt' })).toHaveAttribute('href', '/dms?folder=behoerden%2Ffinanzamt');
    await expect(place.getByRole('link', { name: 'behoerden' })).toHaveAttribute('href', '/dms?folder=behoerden');
    // Derselbe Weg wie in der Liste: Toast mit „Rückgängig“.
    const moved = page.locator('[data-sonner-toast]').filter({ hasText: `„${subject}“ nach finanzamt verschoben` });
    await expect(moved).toBeVisible();
    await moved.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(place).toHaveText('Eingangskorb');
  });

  test('lehnt der Server das Verschieben am Dokument ab, bleibt der Dialog offen und nennt den Grund', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await page.getByRole('row').nth(1).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await page.getByRole('button', { name: 'Verschieben nach…' }).click();
    const dialog = page.getByRole('dialog', { name: /verschieben nach…$/ });
    await dialog.getByRole('treeitem', { name: /^protokolle,/ }).click();

    await renameFolderElsewhere(page, 'protokolle', 'sitzungsprotokolle');

    await dialog.getByRole('button', { name: 'Nach „protokolle“ verschieben' }).click();
    await expect(dialog.getByText('Den Ordner „protokolle“ gibt es nicht mehr. Wählen Sie einen anderen.')).toBeVisible();
    await expect(page.locator('[data-folder-path]')).toHaveText('Eingangskorb');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });

  test('legt am Dokument einen Bezug zu einem Kontakt an und entfernt ihn wieder', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    // Die Nummer ist kopierbarer Text; geöffnet wird über den Betreff (RowLink, Mittelweg Zeilenklick).
    await page.getByRole('row').filter({ hasText: /BRF-\d{4}-\d{3}/ }).first().getByRole('link').first().click();
    await page.getByRole('button', { name: 'Bezug hinzufügen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Bezug hinzufügen', exact: true });
    await dialog.getByRole('combobox', { name: 'Kontakt' }).fill('Mus');
    await page.getByTestId('contact-option').first().click();
    await dialog.getByLabel('Rolle').selectOption('about');
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    const links = page.getByTestId('document-links');
    await expect(links.getByText('Betrifft')).toBeVisible();
    await links.getByRole('button', { name: 'Entfernen' }).last().click();
    await expect(links.getByText('Betrifft')).toBeHidden();
  });

  test('ein Eingang ist Anlage zu einem Brief, und beide Seiten sagen es', async ({ page }) => {
    await login(page);
    await page.goto('/dms?direction=incoming');
    await page.getByRole('row').nth(1).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await page.getByRole('button', { name: 'Dokumentbezug hinzufügen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dokumentbezug hinzufügen' });
    // Der Seed setzt „Antwort auf“ schon; hier eine zweite Art.
    await dialog.getByLabel('Art').selectOption('attachmentOf');
    await dialog.getByRole('combobox', { name: 'Dokument' }).fill('BRF');
    await page.getByTestId('document-option').first().click();
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    const relations = page.getByTestId('document-relations');
    await expect(relations.getByText('Anlage zu')).toBeVisible();
    // Der Link im Eintrag „Anlage zu“, nicht der letzte BRF-Link: Daneben steht der Bezug „Antwort auf“ aus dem Seed,
    // und welcher Brief zuerst gefunden wird, hängt davon ab, was vorher im selben Worker angelegt wurde (Teil C Task 2d).
    await relations.getByRole('listitem').filter({ hasText: 'Anlage zu' }).getByRole('link', { name: /BRF-/ }).click();
    await expect(page.getByTestId('document-relations').getByText('Anlage:')).toBeVisible();
  });

  test('antwortet auf einen Eingang: Entwurf mit Betreff, Ordner und Absender als Empfänger, die Quelle sagt „beantwortet durch“', async ({ page, baseURL }) => {
    await login(page);
    // Der Seed-Bescheid liegt im Eingangskorb und hat keinen Absender — beides kommt hier dazu.
    const client = await mcpClient(page, baseURL);
    const listed = await callTool<{ documents: { id: string; number: string }[] }>(client, 'dms_list', { text: 'Freistellungsbescheid', direction: 'incoming', limit: 1 });
    const source = listed.documents[0]!;
    const contacts = await callTool<{ contacts: { id: string }[] }>(client, 'contacts_list', { text: 'Sandberg' });
    await callTool(client, 'dms_link', { documentId: source.id, entityType: 'contact', entityId: contacts.contacts[0]!.id, role: 'sender' });
    await callTool(client, 'dms_move', { id: source.id, folder: 'behoerden/finanzamt' });
    const letter = (await callTool<{ documents: { id: string }[] }>(client, 'dms_list', { text: 'Dankschreiben', limit: 1 })).documents[0]!;
    await client.close();

    await page.goto(`/dms/${source.id}`);
    await page.getByRole('button', { name: 'Antworten' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}\/edit$/);
    await expect(page.locator('#subject')).toHaveValue('Ihr Schreiben vom 15.02.2026: Freistellungsbescheid');
    await expectFolder(page.locator('body'), 'behoerden/finanzamt', 'behoerden › finanzamt');
    await expect(page.getByRole('combobox', { name: 'Empfänger' })).toHaveValue('Mira Sandberg');

    await page.goto(`/dms/${source.id}`);
    await expect(page.getByTestId('document-relations').getByRole('listitem').filter({ hasText: 'beantwortet durch' })).toBeVisible();

    // Am eigenen, abgelegten Brief heißt derselbe Knopf „Folgeschreiben“.
    await page.goto(`/dms/${letter.id}`);
    await expect(page.getByRole('button', { name: 'Folgeschreiben' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Antworten' })).toHaveCount(0);
  });

  test('vermerkt den Versand eines Briefs und entfernt den Vermerk wieder', async ({ page }) => {
    // Eine React-Warnung im Dialog ist ein Befund, kein Rauschen (Befund 7).
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') warnings.push(m.text()); });
    await login(page);
    await page.goto('/dms');
    // Der zweite Brief des Seeds ist festgeschrieben und noch nicht versandt.
    await page.getByRole('link', { name: 'Dankschreiben an die Tierarztpraxis' }).click();
    await page.getByRole('button', { name: 'Als versandt vermerken' }).click();
    const dialog = page.getByRole('dialog', { name: 'Als versandt vermerken' });
    await dialog.getByLabel('Versandt am').fill('2026-09-06');
    await dialog.getByLabel('Weg').selectOption('email');
    await dialog.getByRole('button', { name: 'Vermerken' }).click();
    const panel = page.getByTestId('dispatch-panel');
    await expect(panel).toContainText('E-Mail');
    await panel.getByRole('button', { name: 'Vermerk entfernen' }).click();
    await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
    await expect(panel).toContainText('Noch nicht versandt.');
    expect(warnings.filter((w) => w.includes('Base UI'))).toEqual([]);
  });

  test('legt eine Wiedervorlage an und hakt sie ab', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    // Die Nummer ist kopierbarer Text; geöffnet wird über den Betreff (RowLink, Mittelweg Zeilenklick).
    await page.getByRole('row').filter({ hasText: /BRF-\d{4}-\d{3}/ }).first().getByRole('link').first().click();
    await page.getByRole('button', { name: 'Neue Wiedervorlage' }).click();
    const dialog = page.getByRole('dialog', { name: 'Neue Wiedervorlage' });
    await dialog.getByLabel('Fällig am').fill('2026-10-01');
    await dialog.getByLabel('Anlass').fill('Nachfragen');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    const panel = page.getByTestId('follow-ups-panel');
    await expect(panel.getByText('Nachfragen')).toBeVisible();
    await panel.getByRole('checkbox', { name: 'Nachfragen erledigen' }).click();
    await expect(panel.getByText('Nachfragen')).toBeHidden();
  });

  test('fügt eine Notiz an, sieht Name und Zeit, löscht sie', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('row').nth(1).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await page.getByLabel('Notiz anfügen').fill('Original liegt im Schrank');
    await page.getByRole('button', { name: 'Anfügen' }).click();
    const journal = page.getByTestId('notes-panel');
    await expect(journal.getByText('Original liegt im Schrank')).toBeVisible();
    await expect(journal.getByText('Anna Berger')).toBeVisible();
    await journal.getByRole('button', { name: 'Notiz löschen' }).last().click();
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(journal.getByText('Original liegt im Schrank')).toBeHidden();
  });

  test('storniert mit Ersatz und landet im Editor des Ersatzes', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('link', { name: 'Einladung zur ordentlichen Mitgliederversammlung' }).click();
    await page.getByRole('button', { name: 'Stornieren' }).click();
    const dialog = page.getByRole('dialog');
    // Der Grund ist Pflicht und sagt es; die Checkbox hat einen Namen.
    await expect(dialog.getByText('* Pflichtfeld')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Ersatz als Entwurf anlegen' })).toBeVisible();
    await dialog.getByLabel('Grund für die Stornierung').fill('Falsches Datum');
    await dialog.getByRole('checkbox', { name: 'Ersatz als Entwurf anlegen' }).check();
    await dialog.getByRole('button', { name: 'Stornieren bestätigen' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}\/edit$/);
    await expect(page.getByLabel('Betreff')).toHaveValue('Einladung zur ordentlichen Mitgliederversammlung');
  });

  /**
   * Spec 2026-09-19: Ein abgelegter Eingang bekommt nachträglich eine andere
   * Art. Er zieht eine neue Nummer, die alte bleibt vermerkt und auffindbar.
   * Ein ausgehendes Dokument bietet das nicht an.
   */
  test('klassifiziert einen Eingang um und findet ihn unter der alten Nummer', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('row').filter({ hasText: 'Freistellungsbescheid' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    const oldNumber = (await page.getByText(/^BEH-\d{4}-\d{3}$/).first().textContent())!.trim();

    await page.getByRole('button', { name: 'Angaben ändern' }).click();
    const dialog = page.getByRole('dialog', { name: 'Angaben ändern' });
    await dialog.getByLabel('Art').selectOption({ label: 'Vertrag' });
    await expect(dialog.getByText(/Neue Nummer: VER-\d{4}-\d{3}/)).toBeVisible();
    await expect(dialog.getByText(new RegExp(`bisher ${oldNumber}`))).toBeVisible();
    await dialog.getByRole('button', { name: 'Angaben speichern' }).click();

    await expect(page.getByText(/^VER-\d{4}-\d{3}$/).first()).toBeVisible();
    await expect(page.getByText(`Früher: ${oldNumber}`)).toBeVisible();

    await page.goto(`/dms?text=${encodeURIComponent(oldNumber)}`);
    await expect(page.getByRole('row').filter({ hasText: 'Freistellungsbescheid' })).toHaveCount(1);
  });

  test('bietet am ausgehenden Dokument kein Umklassifizieren an', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('row').filter({ hasText: 'Einladung zur ordentlichen Mitgliederversammlung' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(page.getByRole('heading', { name: 'Einladung zur ordentlichen Mitgliederversammlung' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Angaben ändern' })).toHaveCount(0);
  });

  test('zieht eine Zeile der Liste auf einen Ordner und verschiebt sie', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();
    await expandFolder(page, 'behoerden');
    const row = page.getByRole('row').nth(1);
    const subject = (await row.getByRole('cell').nth(2).textContent())?.trim() ?? '';
    const rowId = await row.getAttribute('data-document-id');
    expect(rowId).toBeTruthy();
    await page.evaluate(({ id }) => {
      const transfer = new DataTransfer();
      transfer.setData('application/x-kompass-documents', JSON.stringify([id]));
      const target = document.querySelector('[data-folder="behoerden/finanzamt"]')!;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    }, { id: rowId });
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `„${subject}“ nach finanzamt verschoben` })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: subject })).toHaveCount(0);
  });

  test('markiert nicht versandte Ausgänge und offene Wiedervorlagen in der Liste', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(page.getByRole('row').filter({ hasText: 'nicht versandt' }).first()).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Wiedervorlage' }).first()).toBeVisible();

    await page.getByLabel('Wiedervorlage', { exact: true }).selectOption('open');
    await expect(page).toHaveURL(/followUp=open/);
    const rows = page.getByRole('row');
    await expect(rows.filter({ hasText: 'Wiedervorlage' })).toHaveCount((await rows.count()) - 1);

    await page.getByLabel('Versand', { exact: true }).selectOption('unsent');
    await expect(page).toHaveURL(/unsent=1/);
  });

  test('legt Post als Antwort auf einen Brief ab', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles(FIXTURE_PDF);
    // Erst die Einsortierregeln laufen lassen, dann tippen: Ihr Vorschlag setzt
    // Felder, und ein Neuzeichnen mitten in einem gesetzten Wert verschluckt
    // ihn. Im Container fiel genau das auf — dort kommt der Vorschlag später.
    await expect(dialog.getByText(/wird beim Ablegen gezogen/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByLabel('Betreff').fill('Antwort der Praxis');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Antwort der Praxis');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-09-10');
    await dialog.getByRole('combobox', { name: 'Antwort auf' }).fill('BRF');
    await page.getByTestId('document-option').first().click();
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    // Kalt übersetzt der Server die Action beim ersten Ablegen erst — fünf
    // Sekunden reichten im Prüflauf vom 2026-09-12 nicht, warm dreimal 1 s.
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/, { timeout: 30_000 });
    await expect(page.getByTestId('document-relations').getByText(/Antwort auf/)).toBeVisible();
  });

  test('fügt einen Baustein an der Schreibmarke ein und übernimmt den Betreff in einen leeren Entwurf', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Baustein einfügen').selectOption({ label: 'Bitte um Rückmeldung' });
    await expect(page.getByLabel('Betreff')).toHaveValue('Bitte um Rückmeldung');
    const body = page.getByLabel('Text');
    // Wackler seit 2026-09-17: `fill` markiert erst alles und fügt dann ein. `insertSnippet` setzt die Schreibmarke
    // aber erst einen Frame nach dem Commit (requestAnimationFrame: focus + setSelectionRange ans Ende des Bausteins).
    // Läuft dieser Frame zwischen Markieren und Einfügen, ist die Markierung weg und `fill` hängt an. Deshalb erst
    // füllen, wenn der Frame gelaufen ist: Text vollständig da und das Feld hat den Fokus, den nur der Frame setzt.
    await expect(body).toHaveValue('Wir bitten um Ihre Rückmeldung bis zum genannten Termin.');
    await expect(body).toBeFocused();
    await body.fill('Anfang ');
    await expect(body).toHaveValue('Anfang ');
    await body.evaluate((el: HTMLTextAreaElement) => { el.setSelectionRange(el.value.length, el.value.length); });
    await page.getByLabel('Baustein einfügen').selectOption({ label: 'Grußformel' });
    await expect(body).toHaveValue(/^Anfang Mit freundlichen Grüßen/);
  });

  test('löscht eine leere, selbst angelegte Dokumentart, aber nicht die mit Dokumenten (Task 4)', async ({ page }) => {
    await login(page);
    await page.goto('/admin/dms?panel=types');
    await page.getByRole('button', { name: 'Dokumentart anlegen' }).click();
    const create = page.getByRole('dialog', { name: 'Neue Dokumentart' });
    await create.getByLabel('Schlüssel').fill('probe-memo');
    await create.getByLabel('Präfix').fill('PMO');
    await create.getByLabel('Bezeichnung').fill('Probe-Vermerk');
    await create.getByRole('button', { name: 'Speichern' }).click();
    const newRow = page.getByRole('row').filter({ hasText: 'Probe-Vermerk' });
    await expect(newRow).toBeVisible();

    // Eine seedende Art mit Dokumenten (Brief, BRF) bietet „Löschen“ nicht an.
    const letterRow = page.getByRole('row').filter({ hasText: 'Brief' }).filter({ hasText: 'BRF' });
    await expect(letterRow.getByRole('button', { name: 'Löschen' })).not.toBeVisible();
    await expect(letterRow.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();

    await newRow.getByRole('button', { name: 'Löschen' }).click();
    const confirm = page.getByRole('dialog', { name: 'Dokumentart löschen' });
    await expect(confirm).toContainText('Probe-Vermerk');
    await confirm.getByRole('button', { name: 'Dokumentart löschen' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Probe-Vermerk' })).toHaveCount(0);
  });

  test('verwaltet Textbausteine und Versandwege', async ({ page }) => {
    await login(page);
    await page.goto('/admin/dms?panel=snippets');
    await page.getByRole('button', { name: 'Baustein anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Baustein anlegen' });
    await dialog.getByLabel('Name').fill('Absage');
    await dialog.getByLabel('Text').fill('Leider müssen wir absagen.');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Absage' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Bereiche der Akte' }).getByRole('link', { name: 'Versand' }).click();
    await page.getByRole('button', { name: 'Versandweg anlegen' }).click();
    const channel = page.getByRole('dialog', { name: 'Versandweg anlegen' });
    await channel.getByLabel('Schlüssel').fill('courier');
    await channel.getByLabel('Beschriftung').fill('Kurier');
    await channel.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Kurier' })).toBeVisible();
  });

  test('die Kontaktseite zeigt die Dokumente des Kontakts und beginnt von dort einen Brief', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('link', { name: 'Einladung zur ordentlichen Mitgliederversammlung' }).click();
    const contactLink = page.getByTestId('document-links').getByRole('link').first();
    const contactName = await contactLink.textContent();
    await contactLink.click();
    await expect(page).toHaveURL(/\/contacts\//);
    const box = page.getByTestId('related-documents');
    // Der Kontakt ist Empfänger beider Seed-Briefe.
    await expect(box.getByRole('link', { name: /BRF-/ }).first()).toBeVisible();
    await box.getByRole('link', { name: 'Brief schreiben' }).click();
    await expect(page).toHaveURL(/\/dms\/new\?recipient=/);
    await expect(page.getByRole('combobox', { name: 'Empfänger' })).toHaveValue(contactName!.trim());
    await expect(page.getByText('von der Kontaktseite')).toBeVisible();
  });

  test('von der Kontaktseite aus Post ablegen belegt den Absender vor', async ({ page }) => {
    await login(page);
    await page.goto('/contacts');
    // Die Kontaktliste öffnet über den Namen, nicht über die Zeile.
    await page.getByRole('row').nth(1).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/contacts\/[0-9A-Z]{26}$/);
    await page.getByTestId('related-documents').getByRole('link', { name: 'Post ablegen' }).click();
    const dialog = receiveDialog(page);
    await expect(dialog.getByRole('combobox', { name: 'Absender' })).not.toHaveValue('');
  });

  test('ein Tier zeigt seine Dokumente und legt Post mit Bezug „betrifft“ ab', async ({ page }) => {
    await login(page);
    await page.goto('/animals');
    // Die Tierliste navigiert über den Namen, nicht über die Zeile.
    await page.getByRole('row').nth(1).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/animals\/[0-9A-Z]{26}$/);
    await page.getByTestId('related-documents').getByRole('link', { name: 'Post ablegen' }).click();
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles(FIXTURE_PDF);
    await dialog.getByLabel('Betreff').fill('Impfpass');
    await expect(dialog.getByLabel('Betreff')).toHaveValue('Impfpass');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-09-10');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByTestId('document-links').getByText('Betrifft')).toBeVisible();
    await page.getByTestId('document-links').getByRole('link').first().click();
    await expect(page.getByTestId('related-documents').getByText('Impfpass')).toBeVisible();
  });
});

function samplePdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}

/**
 * Die Prüfsumme eines festgeschriebenen Dokuments wird vor jeder Ausgabe
 * nachgerechnet (S6). Dieser Test tauscht die Datei so aus, wie es jemand mit
 * Zugriff auf das Datenvolume täte — am Programm vorbei, direkt im
 * Dateisystem — und prüft, dass die Akte das meldet, statt sie anzuzeigen.
 */
test('ein ausgetauschtes Dokument wird nicht angezeigt, sondern gemeldet', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await login(page);

  await page.goto('/dms');
  await page.getByRole('link', { name: /Einladung zur ordentlichen Mitgliederversammlung/ }).first().click();
  await expect(page.getByRole('heading', { name: /Einladung zur ordentlichen/ })).toBeVisible();
  // Solange die Datei stimmt, steht das PDF da und der Knopf führt hin.
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.getByRole('link', { name: 'PDF öffnen' })).toBeVisible();

  const id = new URL(page.url()).pathname.split('/').pop()!;
  // Der Datenpfad gehört dem Server dieses Workers (`fixtures.ts`).
  const datei = path.join(process.env.E2E_DATA_PATH!, 'dms', `${id.toLowerCase()}.pdf`);
  // Der Reset stellt die Datenbank wieder her, nicht das Datenvolume: Ohne
  // diese Sicherung liefe der nächste Test, der dieses Dokument liest, gegen
  // eine ausgetauschte Datei — und schlüge scheinbar grundlos fehl.
  const original = readFileSync(datei);
  try {
    writeFileSync(datei, '%PDF-1.4\n% ausgetauscht\n%%EOF\n');

    await page.reload();

    // Nicht `getByRole('alert')` allein: Next hängt seinen eigenen
    // Route-Announcer mit derselben Rolle in jede Seite.
    await expect(page.getByRole('alert').filter({ hasText: 'festgeschriebene' })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'PDF öffnen' })).toHaveCount(0);

    // Und der Befund steht in der Akte des Vereins, nicht nur auf dem Bildschirm.
    await page.goto('/admin/audit');
    await expect(page.getByRole('cell', { name: 'dms.checksumMismatch' }).first()).toBeVisible();
  } finally {
    writeFileSync(datei, original);
  }
});

/**
 * Der Aktenexport bündelt einen Jahrgang als ZIP (Vorarbeiten-Spec § 7). Der
 * Seed trägt festgeschriebene Dokumente des laufenden Jahres — das
 * vorbelegte Jahr trifft also, ohne dass der Test ein Datum nachtragen muss.
 */
test('exports a folder as a bundle', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await login(page);
  await page.goto('/dms');
  await page.getByRole('button', { name: 'Bündel exportieren' }).click();
  await page.getByRole('radio', { name: 'Einen Jahrgang' }).check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Bündel herunterladen' }).click();
  expect((await download).suggestedFilename()).toMatch(/^Akte-Jahrgang-\d{4}-.*\.zip$/);
});

/** Wie in Tier- und Kontaktliste (Befund Joe, 2026-09-30): Die Felder lasen die Adresse nur beim ersten Rendern. */
test('die Filterfelder der Akte folgen der Adresse, auch wenn sie von außen wechselt', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await login(page);
  await page.goto('/dms');
  await page.getByLabel('Richtung', { exact: true }).selectOption('outgoing');
  await expect(page).toHaveURL(/direction=outgoing/);
  await page.getByRole('navigation').getByRole('link', { name: 'Akte', exact: true }).first().click();
  await expect(page).toHaveURL(/\/dms$/);
  await expect(page.getByLabel('Richtung', { exact: true })).toHaveValue('');
});

/**
 * Ordner pflegt man in der Akte selbst (Plan 3, Task 1): verschieben per
 * Ziehen, Tastatur oder „Verschieben nach…“, umbenennen, löschen — jede
 * Änderung mit „Rückgängig“ im Toast, und die Adresse folgt dem geöffneten
 * Ordner, ohne einen Verlaufseintrag zu hinterlassen.
 */
test.describe('Ordnerbaum', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  const treeRow = (page: Page, name: string) => folderTree(page).getByRole('treeitem', { name: new RegExp(`^${name},`) });
  const toastWith = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

  /** Nimmt „amtsgericht“ per Tastatur auf und legt es in „vertraege“ ab. */
  async function moveAmtsgerichtByKeyboard(page: Page) {
    await expandFolder(page, 'behoerden');
    await page.getByRole('link', { name: /Eingangskorb/ }).focus();
    await page.keyboard.press('Tab');
    await expect(treeRow(page, 'behoerden')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(treeRow(page, 'amtsgericht')).toBeFocused();
    await page.keyboard.press('Control+Shift+D');
    // behoerden › amtsgericht, finanzamt, korrespondenz…, protokolle, vertraege
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowDown');
    await expect(treeRow(page, 'vertraege')).toBeFocused();
    await page.keyboard.press('Enter');
  }

  test('verschiebt einen Ordner per Tastatur und nimmt es mit „Rückgängig“ zurück', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await moveAmtsgerichtByKeyboard(page);

    const moved = toastWith(page, /Ordner amtsgericht mit .+ nach vertraege verschoben/);
    await expect(moved).toBeVisible();
    await expect(page.locator('[data-folder="behoerden/amtsgericht"]')).toHaveCount(0);
    await expandFolder(page, 'vertraege');
    await expect(page.locator('[data-folder="vertraege/amtsgericht"]')).toBeVisible();

    await moved.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(toastWith(page, 'amtsgericht liegt wieder in behoerden')).toBeVisible();
    await expect(page.locator('[data-folder="behoerden/amtsgericht"]')).toBeVisible();
    await expect(page.locator('[data-folder="vertraege/amtsgericht"]')).toHaveCount(0);
  });

  test('benennt den geöffneten Ordner um, und die Adresse folgt ohne neuen Verlaufseintrag', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await treeRow(page, 'protokolle').click();
    await expect(page).toHaveURL(/folder=protokolle$/);
    await expect(treeRow(page, 'protokolle')).toHaveAttribute('aria-current', 'page');

    await treeRow(page, 'protokolle').focus();
    await page.keyboard.press('F2');
    const input = folderTree(page).getByRole('textbox', { name: 'Name des Ordners' });
    await expect(input).toHaveValue('protokolle');
    await input.fill('sitzungsprotokolle');
    await expect(input).toHaveValue('sitzungsprotokolle');
    await input.press('Enter');

    await expect(page).toHaveURL(/folder=sitzungsprotokolle$/);
    await expect(treeRow(page, 'sitzungsprotokolle')).toHaveAttribute('aria-current', 'page');
    await expect(toastWith(page, 'Ordner protokolle in sitzungsprotokolle umbenannt')).toBeVisible();

    // Zurück führt hinter den Ordner, nicht auf seinen alten Namen.
    await page.goBack();
    await expect(page).toHaveURL(/\/dms$/);
  });

  test('löscht einen leeren, geöffneten Ordner ohne Rückfrage; die Akte springt in den Elternordner', async ({ page }) => {
    await login(page);
    await page.goto('/dms?folder=behoerden%2Ffinanzamt');
    const row = treeRow(page, 'finanzamt');
    await expect(row).toHaveAttribute('aria-current', 'page');
    await row.locator('[data-row-menu]').click();
    await page.getByRole('menuitem', { name: 'Löschen' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/folder=behoerden$/);
    await expect(page.locator('[data-folder="behoerden/finanzamt"]')).toHaveCount(0);

    const deleted = toastWith(page, 'Ordner finanzamt gelöscht');
    await deleted.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.locator('[data-folder="behoerden/finanzamt"]')).toBeVisible();
    await expect(page).toHaveURL(/folder=behoerden$/);
  });

  test('öffnet bei einem verschwundenen Ordner den nächsten vorhandenen Vorfahren mit Hinweis', async ({ page }) => {
    await login(page);
    await page.goto('/dms?folder=gibt-es-nicht%2Funter');
    await expect(page.getByTestId('folder-gone')).toContainText('unter');
    await expect(page.getByRole('link', { name: /Alle Dokumente/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Einladung zur ordentlichen Mitgliederversammlung/ }).first()).toBeVisible();

    await page.goto('/dms?folder=behoerden%2Fgibt-es-nicht');
    await expect(page.getByTestId('folder-gone')).toContainText('gibt-es-nicht');
    await expect(page.getByTestId('folder-gone')).toContainText('behoerden');
    await expect(treeRow(page, 'behoerden')).toHaveAttribute('aria-current', 'page');
  });

  test('„Rückgängig“ nimmt den Zug zurück, auch wenn inzwischen ein anderer Ordner offen ist', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await moveAmtsgerichtByKeyboard(page);
    const moved = toastWith(page, /Ordner amtsgericht mit .+ nach vertraege verschoben/);
    await expect(moved).toBeVisible();

    await treeRow(page, 'protokolle').click();
    await expect(page).toHaveURL(/folder=protokolle$/);
    await moved.getByRole('button', { name: 'Rückgängig' }).click();

    await expect(toastWith(page, 'amtsgericht liegt wieder in behoerden')).toBeVisible();
    await expect(page.locator('[data-folder="behoerden/amtsgericht"]')).toBeAttached();
    await expect(page).toHaveURL(/folder=protokolle$/);
  });

  test('„Als Paket exportieren“ öffnet den Export mit diesem Ordner', async ({ page }) => {
    await login(page);
    await page.goto('/dms?folder=protokolle');
    await treeRow(page, 'protokolle').locator('[data-row-menu]').click();
    await page.getByRole('menuitem', { name: 'Als Paket exportieren' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dokumente als Bündel' });
    await expect(dialog.getByRole('radio', { name: /Diesen Ordner/ })).toBeChecked();
  });

  test('ohne dms.manage gibt es weder „Neuer Ordner“ noch das Menü am Ordner', async ({ page }) => {
    await login(page);
    await switchToJonas(page);
    await page.goto('/dms?folder=protokolle');
    await expect(treeRow(page, 'protokolle')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Neuer Ordner' })).toHaveCount(0);
    await expect(folderTree(page).locator('[data-row-menu]')).toHaveCount(0);
  });

  test('„Neuer Entwurf“ übernimmt den geöffneten Ordner und legt den Brief dort ab', async ({ page }) => {
    await login(page);
    await page.goto('/dms?folder=behoerden%2Ffinanzamt');
    await page.getByRole('link', { name: 'Neuer Entwurf' }).click();
    await expect(page).toHaveURL(/\/dms\/new\?folder=behoerden%2Ffinanzamt/);
    await expectFolder(page.locator('body'), 'behoerden/finanzamt', 'behoerden › finanzamt');
    await page.getByLabel('Betreff').fill('Einspruch Finanzamt');
    await page.getByLabel('Text').fill('Text');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await page.getByRole('link', { name: 'Zurück zum Dokument' }).click();
    await expect(page.getByText('behoerden › finanzamt').first()).toBeVisible();
  });

  test('„Neuer Entwurf“ mit unbekanntem Ordner: Feld leer, keine Fehlermeldung; Empfänger und Ordner zusammen', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new?folder=gibt-es-nicht');
    await expect(page.locator('form input[name="folder"]')).toHaveValue('');
    await expect(page.locator('form [role="alert"]')).toHaveCount(0);

    await page.goto('/dms');
    await page.getByRole('link', { name: 'Einladung zur ordentlichen Mitgliederversammlung' }).click();
    const contactLink = page.getByTestId('document-links').getByRole('link').first();
    const recipientId = (await contactLink.getAttribute('href'))!.split('/').pop()!;
    await page.goto(`/dms/new?recipient=${recipientId}&folder=vertraege`);
    await expectFolder(page.locator('form'), 'vertraege', 'vertraege');
    await expect(page.getByRole('combobox', { name: 'Empfänger' })).not.toHaveValue('');
  });
});

/**
 * Mehrfachauswahl in der Akte (README § 3, Artboards 1, 2b, 5c; § 5): Zeilen
 * ankreuzen, gemeinsam per „Verschieben nach…“ oder Ziehen verschieben, jeder
 * Zug mit eigenem „Rückgängig“, das den Ort prüft.
 */
test.describe('Mehrfachauswahl', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  const toastWith = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });
  const rowOf = (page: Page, id: string) => page.locator(`tr[data-document-id="${id}"]`);
  const selectionBar = (page: Page) => page.getByTestId('selection-bar');

  /** „Rückgängig“ in einem Toast; ältere liegen im Stapel hinter dem neuesten, bis der Zeiger darüber steht. */
  async function undoIn(page: Page, toast: ReturnType<typeof toastWith>) {
    await page.locator('[data-sonner-toast][data-front="true"]').hover();
    await toast.getByRole('button', { name: 'Rückgängig' }).click();
  }

  /** Die IDs der ersten `n` Zeilen der Liste, sobald die Seite zuhört. */
  async function firstIds(page: Page, n: number): Promise<string[]> {
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();
    await expect(page.locator('tr[data-document-id]').nth(n - 1)).toBeAttached();
    const ids = await page.locator('tr[data-document-id]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-document-id')!));
    return ids.slice(0, n);
  }

  async function tick(page: Page, id: string) {
    const box = rowOf(page, id).getByRole('checkbox');
    await box.click();
    await expect(box).toBeChecked();
  }

  /**
   * Zieht die Zeile `id` auf einen Ordner: `dragstart` an der Zeile (sie legt
   * das Ziehgut in den DataTransfer), dann die Ereignisse am Ziel. `dragend`
   * nur, wenn die Zeile noch steht — verschwindet sie vorher, kommt es auch im
   * Browser nie an.
   */
  async function dragRow(page: Page, id: string, folder: string) {
    await page.evaluate(
      ({ id, folder }) => {
        const row = document.querySelector(`tr[data-document-id="${id}"]`)!;
        const target = document.querySelector(`[data-folder="${folder}"]`)!;
        const transfer = new DataTransfer();
        row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
        for (const type of ['dragenter', 'dragover', 'drop']) {
          target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
        }
        if (row.isConnected) row.dispatchEvent(new DragEvent('dragend', { dataTransfer: transfer, bubbles: true }));
      },
      { id, folder }
    );
  }

  /** „Verschieben nach…“ der Auswahl, Ziel `behoerden › finanzamt`. */
  async function moveSelectionToFinanzamt(page: Page, count: number) {
    await selectionBar(page).getByRole('button', { name: 'Verschieben nach…' }).click();
    const dialog = page.getByRole('dialog', { name: `${count} Dokumente verschieben nach…` });
    // Liegt schon etwas in finanzamt, ist der Weg dorthin beim Öffnen offen.
    const behoerden = dialog.getByRole('treeitem', { name: /^behoerden,/ });
    if ((await behoerden.getAttribute('aria-expanded')) !== 'true') await behoerden.locator('[data-toggle]').click();
    await dialog.getByRole('treeitem', { name: /^finanzamt,/ }).click();
    await dialog.getByRole('button', { name: 'Nach „finanzamt“ verschieben' }).click();
    await expect(dialog).toHaveCount(0);
  }

  test('kreuzt drei Zeilen an, verschiebt sie gemeinsam und nimmt es mit „Rückgängig“ zurück', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    const ids = await firstIds(page, 3);
    for (const id of ids) await tick(page, id);
    await expect(selectionBar(page)).toContainText('3 ausgewählt');

    await moveSelectionToFinanzamt(page, 3);
    const moved = toastWith(page, '3 Dokumente nach finanzamt verschoben');
    await expect(moved).toBeVisible();
    for (const id of ids) await expect(rowOf(page, id)).toHaveCount(0);
    await expect(selectionBar(page)).toHaveCount(0);

    await moved.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(toastWith(page, '3 Dokumente liegen wieder im Eingangskorb')).toBeVisible();
    for (const id of ids) await expect(rowOf(page, id)).toHaveCount(1);
  });

  test('wer eine angekreuzte Zeile zieht, zieht alle angekreuzten; eine nicht angekreuzte nur sich selbst', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await expandFolder(page, 'behoerden');
    const [a, b, c, d] = await firstIds(page, 4);
    await tick(page, a!);
    await tick(page, b!);

    // Nicht angekreuzt: nur diese Zeile, die Auswahl bleibt.
    await dragRow(page, c!, 'vertraege');
    await expect(toastWith(page, /^„.+“ nach vertraege verschoben/)).toBeVisible();
    await expect(rowOf(page, c!)).toHaveCount(0);
    await expect(rowOf(page, a!)).toHaveCount(1);
    await expect(selectionBar(page)).toContainText('2 ausgewählt');
    await expect(rowOf(page, a!).getByRole('checkbox')).toBeChecked();

    // Angekreuzt: die ganze Auswahl.
    await dragRow(page, b!, 'behoerden/finanzamt');
    await expect(toastWith(page, '2 Dokumente nach finanzamt verschoben')).toBeVisible();
    await expect(rowOf(page, a!)).toHaveCount(0);
    await expect(rowOf(page, b!)).toHaveCount(0);
    await expect(rowOf(page, d!)).toHaveCount(1);
    await expect(selectionBar(page)).toHaveCount(0);
  });

  test('überspringt, was schon im Ziel liegt, und sagt es', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await expandFolder(page, 'behoerden');
    const [a, b, c] = await firstIds(page, 3);
    await tick(page, a!);
    await tick(page, b!);
    await dragRow(page, a!, 'behoerden/finanzamt');
    await expect(toastWith(page, '2 Dokumente nach finanzamt verschoben')).toBeVisible();

    // In „Alle Dokumente“ stehen alle drei; zwei davon liegen schon in finanzamt.
    await page.getByRole('link', { name: /^Alle Dokumente/ }).click();
    await expect(page).toHaveURL(/\/dms$/);
    for (const id of [a!, b!, c!]) await tick(page, id);
    await moveSelectionToFinanzamt(page, 3);
    await expect(toastWith(page, '1 Dokument nach finanzamt verschoben, 2 lagen schon dort')).toBeVisible();
  });

  test('jedes „Rückgängig“ nimmt nur seinen eigenen Zug zurück', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await expandFolder(page, 'behoerden');
    const [a, b] = await firstIds(page, 2);
    await dragRow(page, a!, 'behoerden/finanzamt');
    const first = toastWith(page, /nach finanzamt verschoben/);
    await expect(first).toBeVisible();
    await dragRow(page, b!, 'vertraege');
    await expect(toastWith(page, /nach vertraege verschoben/)).toBeVisible();

    await undoIn(page, first);
    await expect(toastWith(page, /liegt wieder im Eingangskorb/)).toBeVisible();
    await expect(rowOf(page, a!)).toHaveCount(1);
    await expect(rowOf(page, b!)).toHaveCount(0);
  });

  test('ein anderer Ordner ist eine neue Liste: die Auswahl ist weg', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    const [a] = await firstIds(page, 1);
    await tick(page, a!);
    await expect(selectionBar(page)).toContainText('1 ausgewählt');

    await folderTree(page).getByRole('treeitem', { name: /^protokolle,/ }).click();
    await expect(page).toHaveURL(/folder=protokolle$/);
    await expect(selectionBar(page)).toHaveCount(0);
    await expect(page.locator('tr[data-document-id]').getByRole('checkbox', { checked: true })).toHaveCount(0);
  });

  test('„Rückgängig“ lehnt ab, wenn das Dokument inzwischen weiterverschoben wurde', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await expandFolder(page, 'behoerden');
    const [a] = await firstIds(page, 1);
    await dragRow(page, a!, 'behoerden/finanzamt');
    const first = toastWith(page, /nach finanzamt verschoben/);
    await expect(first).toBeVisible();

    await folderTree(page).getByRole('treeitem', { name: /^finanzamt,/ }).click();
    await expect(page).toHaveURL(/folder=behoerden%2Ffinanzamt$/);
    await dragRow(page, a!, 'vertraege');
    await expect(toastWith(page, /nach vertraege verschoben/)).toBeVisible();

    await undoIn(page, first);
    await expect(toastWith(page, /^Nicht mehr rückgängig zu machen/)).toBeVisible();
    await folderTree(page).getByRole('treeitem', { name: /^vertraege,/ }).click();
    await expect(page).toHaveURL(/folder=vertraege$/);
    await expect(rowOf(page, a!)).toHaveCount(1);
  });

  /** Die Zeile eines Ausgangs aus dem Bestand: der Brief im Ordner vereinsregister-2026. */
  async function outgoingRow(page: Page): Promise<string> {
    await page.goto('/dms');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();
    const row = page.locator('tr[data-document-id]').filter({ hasText: 'Einladung zur ordentlichen Mitgliederversammlung' }).first();
    return (await row.getAttribute('data-document-id'))!;
  }

  test('ein Ausgang ohne Ordner heißt „Kein Ordner“, nicht Eingangskorb', async ({ page }) => {
    await login(page);
    const id = await outgoingRow(page);
    await tick(page, id);
    await selectionBar(page).getByRole('button', { name: 'Verschieben nach…' }).click();
    const dialog = page.getByRole('dialog', { name: '„Einladung zur ordentlichen Mitgliederversammlung“ verschieben nach…' });
    await dialog.getByRole('button', { name: /^Kein Ordner/ }).click();
    await dialog.getByRole('button', { name: 'Nach „Kein Ordner“ verschieben' }).click();
    const moved = toastWith(page, '„Einladung zur ordentlichen Mitgliederversammlung“ nach „Kein Ordner“ verschoben');
    await expect(moved).toBeVisible();
    await expect(rowOf(page, id)).toContainText('Kein Ordner');

    await moved.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(toastWith(page, '„Einladung zur ordentlichen Mitgliederversammlung“ liegt wieder in vereinsregister-2026')).toBeVisible();
  });

  /**
   * Wie in der Mediathek (Abnahme 01.10.): Legt der Browser einem Zug aus der
   * Seite eine Datei bei, ist das kein Brief vom Rechner. Die Zeile wird
   * verschoben, der Empfangsdialog geht nicht auf.
   */
  test('eine gezogene Zeile mit beigelegter Datei verschiebt und öffnet keinen Empfang', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();
    const [id] = await firstIds(page, 1);
    await page.evaluate((id) => {
      const row = document.querySelector(`tr[data-document-id="${id}"]`)!;
      const target = document.querySelector('[data-folder="protokolle"]')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(['%PDF-1.4'], 'image.png', { type: 'image/png' }));
      row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      if (row.isConnected) row.dispatchEvent(new DragEvent('dragend', { dataTransfer: transfer, bubbles: true }));
    }, id!);
    await expect(toastWith(page, /nach protokolle verschoben/)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('der Eingangskorb nimmt keinen Ausgang an', async ({ page }) => {
    await login(page);
    const id = await outgoingRow(page);
    const state = await page.evaluate((id) => {
      const row = document.querySelector(`tr[data-document-id="${id}"]`)!;
      const inbox = document.querySelector('[data-fixed="inbox"]')!;
      const transfer = new DataTransfer();
      row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      for (const type of ['dragenter', 'dragover']) {
        inbox.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
      return new Promise<string | null>((resolve) =>
        setTimeout(() => {
          const shown = `${inbox.getAttribute('data-drop')}|${inbox.textContent}`;
          inbox.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
          row.dispatchEvent(new DragEvent('dragend', { dataTransfer: transfer, bubbles: true }));
          resolve(shown);
        }, 50)
      );
    }, id);
    expect(state).toContain('blocked|');
    expect(state).toContain('In den Eingangskorb kommt nur eingegangene Post.');
    await expect(rowOf(page, id)).toContainText('vereinsregister-2026');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
});

/**
 * Wo man ist (Plan 3, Task 4; Spec § 9, Entscheidung Joe 2026-10-01): Ein
 * geöffneter Ordner zeigt seinen ganzen Teilbaum, die Spalte „Ordner“ nennt
 * den Ort darunter; über der Liste stehen Weg und Titel. Dazu der kurze Baum
 * mit Bereichsrecht, das Telefon-Sheet und der Verweis in der Verwaltung.
 */
test.describe('Weg und Teilbaum', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  const treeRow = (page: Page, name: string) => folderTree(page).getByRole('treeitem', { name: new RegExp(`^${name},`) });
  const rows = (page: Page) => page.locator('tr[data-document-id]');
  const heading = (page: Page) => page.getByTestId('folder-heading');
  /** Die Summe, die der Baum am Ordner nennt — aus dem zugänglichen Namen („behoerden, 3 Dokumente“ oder „…, leer“). */
  async function treeTotal(page: Page, name: string): Promise<number> {
    const label = (await treeRow(page, name).getAttribute('aria-label')) ?? '';
    return Number(label.match(/^[^,]+, (\d+)/)?.[1] ?? 0);
  }

  test('ein geöffneter Ordner listet seinen Teilbaum und nennt den Ort darunter', async ({ page }) => {
    await login(page);
    await page.goto('/dms?folder=behoerden');
    await expect(treeRow(page, 'behoerden')).toHaveAttribute('aria-current', 'page');
    const total = await treeTotal(page, 'behoerden');
    expect(total).toBeGreaterThan(0);
    await expect(rows(page)).toHaveCount(total);
    const deep = rows(page).filter({ hasText: 'Einladung zur ordentlichen Mitgliederversammlung' });
    await expect(deep.locator('[data-folder-cell]')).toHaveText('amtsgericht › vereinsregister-2026');

    // Über der Liste: Titel und Anzahl, kein „davon … direkt“; oben im Baum kein Weg davor.
    await expect(heading(page).getByRole('heading', { name: 'behoerden' })).toBeVisible();
    await expect(heading(page)).toContainText(total === 1 ? '1 Dokument' : `${total} Dokumente`);
    await expect(heading(page)).not.toContainText('direkt');
    await expect(heading(page).getByRole('navigation', { name: 'Weg' })).toHaveCount(0);

    // Eine Ebene tiefer: der Weg als Links, der Ordner als Titel.
    await expandFolder(page, 'behoerden');
    await treeRow(page, 'amtsgericht').click();
    await expect(page).toHaveURL(/folder=behoerden%2Famtsgericht$/);
    const path = heading(page).getByRole('navigation', { name: 'Weg' });
    await expect(path.getByRole('link', { name: 'behoerden' })).toHaveAttribute('href', '/dms?folder=behoerden');
    await expect(heading(page).getByRole('heading', { name: 'amtsgericht' })).toBeVisible();
    await expect(deep.locator('[data-folder-cell]')).toHaveText('vereinsregister-2026');

    // Wo das Dokument selbst liegt, bleibt die Spalte leer.
    await page.goto('/dms?folder=behoerden%2Famtsgericht%2Fvereinsregister-2026');
    await expect(heading(page).getByRole('heading', { name: 'vereinsregister-2026' })).toBeVisible();
    await expect(heading(page).getByRole('navigation', { name: 'Weg' }).getByRole('link')).toHaveText(['behoerden', 'amtsgericht']);
    await expect(deep.locator('[data-folder-cell]')).toHaveText('');
  });

  test('nur mit Bereichsrecht: der kurze Baum mit Hinweis darunter', async ({ page, baseURL }) => {
    await login(page);
    // Ein Beleg (Schutzbereich Finanzen) nach „behoerden/finanzamt“ — sonst läge nichts Lesbares in einem Ordner.
    const client = await mcpClient(page, baseURL);
    const listed = await callTool<{ documents: { id: string }[] }>(client, 'dms_list', { typeKey: 'voucher-own', limit: 1 });
    await callTool(client, 'dms_move', { id: listed.documents[0]!.id, folder: 'behoerden/finanzamt' });
    await client.close();

    await switchTo(page, 'Mira Klein', 'mira@kompass.local');
    await page.goto('/dms');
    await expect(page.getByTestId('folder-column')).toContainText('Sie sehen nur Ordner mit Dokumenten, die Sie lesen dürfen. Die Zahlen zählen nur diese.');
    await expect(treeRow(page, 'behoerden')).toBeVisible();
    await expect(treeRow(page, 'protokolle')).toHaveCount(0);
    await expect(treeRow(page, 'vertraege')).toHaveCount(0);
  });

  test('mit dms.view kein Hinweis zum Bereichsrecht', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(treeRow(page, 'protokolle')).toBeVisible();
    await expect(page.getByTestId('folder-column')).not.toContainText('die Sie lesen dürfen');
  });

  test('die Verwaltung der Akte verweist für Ordner auf die Akte', async ({ page }) => {
    await login(page);
    await page.goto('/admin/dms?panel=folders');
    const card = page.getByTestId('folders-moved');
    await expect(card).toContainText('Ordner legen Sie jetzt direkt in der Akte an');
    await expect(card.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ordner anlegen' })).toHaveCount(0);
    await card.getByRole('link', { name: 'Zur Akte' }).click();
    await expect(page).toHaveURL(/\/dms$/);
  });

  test('am Telefon nennt der Ortsknopf dieselbe Zahl wie die Liste, auch mit Filter', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/dms?direction=incoming');
    const filtered = await rows(page).count();
    expect(filtered).toBeGreaterThan(0);
    await page.goto('/dms');
    const all = await rows(page).count();
    // Der Filter muss etwas wegnehmen, sonst beweist der Vergleich nichts.
    expect(filtered).toBeLessThan(all);
    await page.goto('/dms?direction=incoming');
    await expect(page.getByTestId('folder-sheet-count')).toHaveText(String(filtered));
  });

  test('am Telefon öffnet der Ortsknopf den Baum im Sheet; ein Name öffnet den Ordner und schließt es', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/dms');
    await expect(page.getByTestId('folder-column')).toBeHidden();
    const trigger = page.getByTestId('folder-sheet-trigger');
    await expect(trigger).toContainText('Alle Dokumente');
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: 'Ordner' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('treeitem', { name: /^protokolle,/ }).getByRole('link', { name: 'protokolle' }).click();
    await expect(page).toHaveURL(/folder=protokolle$/);
    await expect(sheet).toBeHidden();
    await expect(trigger).toContainText('protokolle');
  });
});
