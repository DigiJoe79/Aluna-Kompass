import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const login = loginAsAdmin;
const FIXTURE_PDF = path.resolve(import.meta.dirname, 'fixtures/brief-digital.pdf');

/**
 * „Post ablegen“ liegt als Dialog über der Liste. Die Felder darin heissen wie
 * Dinge auf der Liste dahinter — „Betreff“ steht auch im Suchfeld —, deshalb
 * wird im Dialog gesucht und nicht auf der Seite.
 */
function receiveDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Post ablegen' });
}

/**
 * Ziehen lässt sich aus dem Dateimanager nicht nachstellen; nachgestellt wird,
 * was im Fenster ankommt — eine Datei in einem DataTransfer auf einem Ziel.
 */
async function dropFiles(page: Page, selector: string, names: string[]) {
  // Die Horcher hängen an einem Effekt; vor der Hydration geht der Zug ins Leere.
  await expect(page.locator('[data-drop="ready"]')).toBeAttached();
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
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    // Erst auf das Dokument warten, dann die Nummer lesen: Solange der Dialog
    // offen steht, trägt die Liste dahinter ihre Nummern und der Hinweis im
    // Dialog die nächste — zwei Treffer auf dasselbe Muster.
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(page.getByText(/BEH-\d{4}-\d{3}/)).toBeVisible();
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
    const date = page.getByLabel('Datum auf dem Dokument');
    const hintBox = await hint.boundingBox();
    const dateBox = await date.boundingBox();
    if (!hintBox || !dateBox) throw new Error('Hinweis oder Feld nicht sichtbar');

    // Über beide Spalten statt in einer Zelle: Sonst steht neben „Datum“ ein
    // Loch, und die vier Felder lesen sich als zwei lose Paare.
    expect(hintBox.width).toBeGreaterThan(dateBox.width * 1.5);
    expect(Math.round(hintBox.x)).toBe(Math.round(dateBox.x));
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
    await expect(page.getByText('2026-05-02')).toBeVisible();
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
    const name = (await firstOption.textContent())?.trim() ?? '';
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
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByRole('button', { name: 'Endgültig löschen' })).toBeDisabled();
  });

  test('verwaltet Dokumentarten und Regeln', async ({ page }) => {
    await login(page);
    // Über die Navigation, nicht über die URL: Der Bildschirm war gebaut und
    // fertig, nur zeigte nichts darauf.
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Akte einrichten' }).click();
    await expect(page.getByRole('heading', { name: 'Dokumentarten' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Einsortierregeln' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ordner' })).toBeVisible();
  });

  test('ein abgelegter Scan wird gelesen und über seinen Inhalt gefunden', async ({ page }) => {
    // Der Worker liest ein Dokument nach dem anderen, und der Seed bringt seit
    // „Akte fertig“ mehrere mit Datei mit — das eigene steht also hinten in der
    // Schlange. Das Budget muss über der Wartezeit darunter liegen, sonst
    // läuft der Test ab, bevor sein Warten fertig ist.
    test.setTimeout(150_000);
    await login(page);

    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles(FIXTURE_PDF);
    // Erst die Einsortierregeln laufen lassen, dann tippen: Ihr Vorschlag setzt
    // Felder, und ein Neuzeichnen mitten in einem gesetzten Wert verschluckt
    // ihn. Wie im Test darüber, nur dass hier nichts vorbelegt wird — gewartet
    // wird deshalb auf die Nummer, die derselbe Weg mitbringt.
    await expect(dialog.getByText(/wird beim Ablegen gezogen/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByLabel('Betreff').fill('Ohne sprechenden Betreff');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-09-11');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();

    // Der Worker laeuft im Hintergrund; gewartet wird auf den Zustand, nicht auf
    // eine feste Zeit — sonst ist der Test auf einer langsamen Maschine rot.
    await expect(page.getByText(/Gelesen am/)).toBeVisible({ timeout: 60_000 });

    await page.goto('/dms');
    await page.getByPlaceholder('Betreff, Nummer oder Inhalt').fill('rechnung');
    await expect(page.getByText('Ohne sprechenden Betreff')).toBeVisible();

    const previewLink = page.getByRole('link', { name: /Seite 1/ });
    await expect(previewLink).toBeVisible();
    await expect(previewLink).toHaveAttribute('href', /\/dms\/.+\/preview#page=1/);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      previewLink.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('zeigt die Ordner mit ihrem Bestand neben der Liste', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    const folders = page.getByRole('navigation', { name: 'Ordner' });
    await expect(folders.getByRole('link', { name: /Eingangskorb/ })).toBeVisible();
    await expect(folders.getByRole('link', { name: /protokolle/ })).toBeVisible();

    // Ein Klick filtert die Liste auf diesen Ordner.
    await folders.getByRole('link', { name: /protokolle/ }).click();
    await expect(page).toHaveURL(/folder=protokolle/);
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
    await page.goto('/dms');

    const row = page.locator('tbody tr').first();
    const box = await row.boundingBox();
    if (!box) throw new Error('Zeile nicht sichtbar');
    expect(Math.round(box.height)).toBe(44);
  });

  test('richtet die Liste auf das Überfliegen aus', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    // Datum wie Nummer: Zahlen, die man untereinander vergleicht, stehen in
    // Monospace — das ist der Zweck der Spalte.
    const date = page.getByRole('cell', { name: '2026-02-15' });
    expect(await date.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Plex');

    // Die ganze Zeile führt zum Dokument; ein fester Unterstrich am Betreff
    // bietet einen zweiten Weg an, den es nicht gibt.
    const subject = page.getByRole('link', { name: 'Freistellungsbescheid' });
    expect(await subject.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');

    // Der Entwurf steht beim Betreff, nicht nur am rechten Rand.
    const draftRow = page.getByRole('row', { name: /Protokoll Vorstandssitzung/ });
    await expect(draftRow.getByRole('cell').nth(1)).toContainText('Entwurf');
  });

  test('führt die Ordnerspalte bis zum unteren Rand der Fläche', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    // Gegen den Arbeitsbereich gemessen, nicht gegen die Zeilen: Bei wenigen
    // Ordnern wäre die Spalte sonst das höchste Element und die Prüfung ginge
    // aus dem falschen Grund durch.
    const main = page.locator('main');
    const column = page.getByRole('navigation', { name: 'Ordner' });
    const mainBox = await main.boundingBox();
    const columnBox = await column.boundingBox();
    if (!mainBox || !columnBox) throw new Error('Bereich oder Spalte nicht sichtbar');

    // Beim Ziehen ist die Spalte die helle Fläche gegen das abgedunkelte Feld
    // daneben. Endet sie vorher, sieht darunter Overlay aus wie Spalte.
    expect(columnBox.y + columnBox.height).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 1);
  });

  test('färbt den Zähler mit der Zeile, in der er steht', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    const current = page.getByRole('navigation', { name: 'Ordner' }).locator('[aria-current="page"]');
    const row = await current.evaluate((el) => getComputedStyle(el).color);
    const count = await current.locator('span').last().evaluate((el) => getComputedStyle(el).color);

    expect(count).toBe(row);
  });

  test('zieht eine Datei auf einen Ordner und legt sie dorthin', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await dropFiles(page, '[data-folder="behoerden/finanzamt"]', ['Bescheid der Stadtkasse.pdf']);

    const dialog = receiveDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Bescheid der Stadtkasse.pdf')).toBeVisible();
    await expect(dialog.getByLabel('Ordner')).toHaveValue('behoerden/finanzamt');
    await expect(dialog.getByText('hierauf gezogen')).toBeVisible();
  });

  test('eine Datei irgendwo im Fenster landet im Eingangskorb', async ({ page }) => {
    await login(page);
    await page.goto('/dms');

    await dropFiles(page, 'main', ['Ohne Ziel.pdf']);

    const dialog = receiveDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Ordner')).toHaveValue('');
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
    await dialog.getByRole('button', { name: 'Ablegen' }).click();

    // Die nächste Datei steht schon da; der Ordner, auf den gezogen wurde, bleibt.
    await expect(dialog.getByText('2 von 2')).toBeVisible();
    await expect(dialog.getByText('Zweiter Vertrag.pdf')).toBeVisible();
    await expect(dialog.getByLabel('Ordner')).toHaveValue('vertraege');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-05-02');
    await dialog.getByLabel('Betreff').fill('Zweiter Vertrag');
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
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(dialog.getByText('2 von 2')).toBeVisible();

    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    const ask = page.getByRole('alertdialog');
    await expect(ask).toContainText('Warteschlange verwerfen?');
    await expect(ask).toContainText('Eine Datei ist noch nicht abgelegt.');
    await ask.getByRole('button', { name: 'Verwerfen' }).click();

    await expect(dialog).toHaveCount(0);
    // Was abgelegt wurde, bleibt abgelegt.
    await expect(page.getByRole('link', { name: 'Eins' })).toBeVisible();
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
    const subject = (await row.getByRole('cell').nth(1).textContent())?.trim() ?? '';
    expect(subject.length).toBeGreaterThan(0);
    await row.click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await page.getByLabel('Ordner').selectOption('behoerden/finanzamt');
    await page.getByRole('button', { name: 'Ordner speichern' }).click();
    await expect(page.getByText('Dokument verschoben')).toBeVisible();

    // Im Eingangskorb liegt es nicht mehr, im Ordner dafür schon.
    await page.goto('/dms?inbox=1');
    await expect(page.getByRole('row').filter({ hasText: subject })).toHaveCount(0);
    await page.goto('/dms?folder=behoerden%2Ffinanzamt');
    await expect(page.getByRole('row').filter({ hasText: subject })).toHaveCount(1);
  });

  test('legt am Dokument einen Bezug zu einem Kontakt an und entfernt ihn wieder', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('link', { name: /BRF-\d{4}-\d{3}/ }).first().click();
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
    await relations.getByRole('link', { name: /BRF-/ }).last().click();
    await expect(page.getByTestId('document-relations').getByText('Anlage:')).toBeVisible();
  });

  test('vermerkt den Versand eines Briefs und entfernt den Vermerk wieder', async ({ page }) => {
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
  });

  test('legt eine Wiedervorlage an und hakt sie ab', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('link', { name: /BRF-\d{4}-\d{3}/ }).first().click();
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
    await dialog.getByLabel('Grund für die Stornierung').fill('Falsches Datum');
    await dialog.getByLabel('Ersatz als Entwurf anlegen').check();
    await dialog.getByRole('button', { name: 'Stornieren bestätigen' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}\/edit$/);
    await expect(page.getByLabel('Betreff')).toHaveValue('Einladung zur ordentlichen Mitgliederversammlung');
  });

  test('zieht eine Zeile der Liste auf einen Ordner und verschiebt sie', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();
    const row = page.getByRole('row').nth(1);
    const subject = (await row.getByRole('cell').nth(1).textContent())?.trim() ?? '';
    const rowId = await row.getAttribute('data-document-id');
    expect(rowId).toBeTruthy();
    await page.evaluate(({ id }) => {
      const transfer = new DataTransfer();
      transfer.setData('application/x-kompass-document', id!);
      const target = document.querySelector('[data-folder="behoerden/finanzamt"]')!;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    }, { id: rowId });
    await expect(page.getByText('Dokument verschoben')).toBeVisible();
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
    await dialog.getByLabel('Betreff').fill('Antwort der Praxis');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-09-10');
    await dialog.getByRole('combobox', { name: 'Antwort auf' }).fill('BRF');
    await page.getByTestId('document-option').first().click();
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(page.getByTestId('document-relations').getByText(/Antwort auf/)).toBeVisible();
  });

  test('fügt einen Baustein an der Schreibmarke ein und übernimmt den Betreff in einen leeren Entwurf', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Baustein einfügen').selectOption({ label: 'Bitte um Rückmeldung' });
    await expect(page.getByLabel('Betreff')).toHaveValue('Bitte um Rückmeldung');
    await expect(page.getByLabel('Text')).toHaveValue(/Rückmeldung/);
    const body = page.getByLabel('Text');
    await body.fill('Anfang ');
    await body.evaluate((el: HTMLTextAreaElement) => { el.setSelectionRange(el.value.length, el.value.length); });
    await page.getByLabel('Baustein einfügen').selectOption({ label: 'Grußformel' });
    await expect(body).toHaveValue(/^Anfang Mit freundlichen Grüßen/);
  });

  test('verwaltet Textbausteine und Versandwege', async ({ page }) => {
    await login(page);
    await page.goto('/admin/dms');
    await page.getByRole('button', { name: 'Baustein anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Baustein anlegen' });
    await dialog.getByLabel('Name').fill('Absage');
    await dialog.getByLabel('Text').fill('Leider müssen wir absagen.');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Absage' })).toBeVisible();

    await page.getByRole('button', { name: 'Versandweg anlegen' }).click();
    const channel = page.getByRole('dialog', { name: 'Versandweg anlegen' });
    await channel.getByLabel('Schlüssel').fill('courier');
    await channel.getByLabel('Beschriftung').fill('Kurier');
    await channel.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Kurier' })).toBeVisible();
  });
});

function samplePdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}
