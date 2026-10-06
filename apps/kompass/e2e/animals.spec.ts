import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');

test.describe('animals', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  /** Spec 2026-10-05 „Tier-Slug fest“: Kompass bildet den Slug, die Maske zeigt ihn nur an, Umbenennen lässt ihn stehen (Review Focus 1). */
  test('bildet den Slug selbst und lässt ihn beim Umbenennen stehen', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await expect(page).toHaveURL(/\/animals\/new/);
    await expect(page.getByLabel('Slug (URL-Teil)')).toHaveCount(0);
    await page.getByLabel('Name').fill('Wilma');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);

    const slug = page.getByLabel('Slug (URL-Teil)');
    await expect(slug).toHaveAttribute('readonly', '');
    await expect(slug).toHaveValue(/^wilma-[0-9a-z]{4}$/);
    const before = await slug.inputValue();

    await page.getByLabel('Name').fill('Wilhelmine');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await page.reload();
    await expect(page.locator('html[data-hydrated="true"]')).toBeAttached();
    await expect(page.getByLabel('Slug (URL-Teil)')).toHaveValue(before);
  });

  test('zwei Hunde mit gleichem Namen werden beide angelegt', async ({ page }) => {
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      await page.goto('/animals/new');
      await page.getByLabel('Name').fill('Doppelt');
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
      urls.push(page.url());
    }
    expect(urls[0]).not.toBe(urls[1]);
  });

  test('creates a dog, adds photos, publishes, adopts with a story', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await expect(page).toHaveURL(/\/animals\/new/);
    await page.getByLabel('Name').fill('Chiara');
    await expect(page.getByText('laufen Anfragen auf der Webseite über den Partner')).toBeVisible();
    await page.getByLabel('Geschlecht').selectOption('female');
    await page.getByLabel('Größe in cm (für den Filter)').fill('45');
    await page.getByLabel('Ort').fill('Rumänien, Brașov');
    await page.getByLabel('Notfall').check();
    await page.getByLabel('Patentier').check();
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await page.locator('[name="summary.de"]').fill('Sanfte, freundliche Hündin.');
    await page.locator('[name="traits__text.de"]').fill('ruhig, verträglich');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);

    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles([
      { name: 'chiara-1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'chiara-2.svg', mimeType: 'image/svg+xml', buffer: SVG },
    ]);
    await expect(chooser.getByText('2 von 12 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(chooser).toBeHidden();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(2);
    // Ein Speichern für Texte und Fotos; die Leiste zählt die Fotos als eine Änderung
    // und nach dem Speichern wieder ab null. Nach dem Neuladen stehen sie aus der Datenbank da.
    await expect(page.getByText('1 Änderung noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await expect(page.getByText('noch nicht gespeichert')).toHaveCount(0);
    // Zweites Speichern ohne Neuladen: Die Maske trägt schon den neuen Versionsstempel.
    await page.locator('[data-testid="animal-photo"]').nth(1).getByRole('button', { name: 'Hauptfoto' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('noch nicht gespeichert')).toHaveCount(0);
    await expect(page.getByText('wurde inzwischen geändert')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('html[data-hydrated="true"]')).toBeAttached();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(2);

    const publish = page.getByRole('switch', { name: 'Veröffentlicht' });
    await publish.click();
    // In der Maske heißt Speichern Speichern: Der Schalter ist ein Feld wie jedes andere und zählt als Änderung.
    await expect(publish).toBeChecked();
    await expect(page.getByText('1 Änderung noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await page.goto('/animals');
    const row = page.getByRole('row', { name: /Chiara/ });
    await expect(row).toContainText('Sucht ein Zuhause');
    await expect(row).toContainText('Notfall');
    await expect(row).toContainText('Veröffentlicht');

    await row.getByRole('link', { name: 'Chiara' }).click();
    // Erst die Maske abwarten: In der Liste träfe „Ort“ auch die Knöpfe „Sortieren nach …“.
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    await expect(page.getByLabel('Ort')).toHaveValue('Rumänien, Brașov');
    await page.getByRole('button', { name: 'Status ändern' }).click();
    await page.getByRole('dialog').getByLabel('Neuer Status').selectOption('adopted');
    await page.getByRole('dialog').getByLabel('Vermittlungsjahr').fill('2026');
    await page.getByRole('dialog').getByRole('button', { name: 'Status setzen' }).click();
    await expect(page.getByRole('status')).toContainText('Status gesetzt');
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await page.getByRole('textbox', { name: 'Zitat der Familie (Deutsch)' }).fill('Endlich zuhause.');
    await page.getByLabel('Familie', { exact: true }).fill('Familie M.');
    await page.locator('[name="beforeCaption.de"]').fill('Auf der Pflegestelle');
    await page.locator('[name="afterCaption.de"]').fill('Zuhause in Köln');
    // Eine Speicherleiste für alle Reiter: Sie zählt die Geschichte mit, und „Speichern“ auf dem Steckbrief schreibt auch sie.
    await expect(page.getByText('4 Änderungen noch nicht gespeichert')).toBeVisible();
    await page.getByRole('tab', { name: 'Steckbrief' }).click();
    await expect(page.getByText('4 Änderungen noch nicht gespeichert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Geschichte speichern' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await page.reload();
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await expect(page.locator('[name="beforeCaption.de"]')).toHaveValue('Auf der Pflegestelle');
    await expect(page.locator('[name="afterCaption.de"]')).toHaveValue('Zuhause in Köln');
  });

  test('filtert und sortiert die Liste; der Weg ins Profil behält die Auswahl', async ({ page }) => {
    await page.goto('/animals');
    await expect(page.getByRole('link', { name: /^Alle \(6\)$/ })).toBeVisible();
    await page.getByRole('link', { name: /^Prüfung offen \(2\)$/ }).click();
    await expect(page).toHaveURL(/review=1/);
    await expect(page.getByTestId('animal-row')).toHaveCount(2);
    // Ohne eigene Wahl steht oben, was am längsten wartet.
    await expect(page.getByTestId('animal-row').first()).toContainText('Prüfung offen');
    await expect(page.getByText('2 von 6 Hunden')).toBeVisible();

    // Kein Treffer ist nicht „noch kein Hund“: Umschalter und Filter bleiben stehen.
    await page.getByLabel('Status', { exact: true }).selectOption('adopted');
    await expect(page.getByText('Kein Hund passt zu dieser Auswahl.')).toBeVisible();
    await expect(page.getByText('0 von 6 Hunden')).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('');
    await expect(page.getByTestId('animal-row')).toHaveCount(2);

    await page.getByRole('link', { name: /^Alle \(6\)$/ }).click();
    await expect(page.getByTestId('animal-row')).toHaveCount(6);
    await page.getByRole('button', { name: 'Sortieren nach Hund' }).click(); // erster Klick: absteigend
    await expect(page.getByTestId('animal-row').first()).toContainText('Pelle');
    await page.getByPlaceholder('Name suchen').fill('mik');
    await expect(page.getByTestId('animal-row')).toHaveCount(1);
    await page.getByRole('link', { name: 'Mika' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+\?text=mik&sort=name&dir=desc$/);
  });

  test('prüft am Stück: Hauptfoto, Foto entfernen, Text, „Geprüft und weiter“', async ({ page }) => {
    // Nach Name absteigend: Pelle (neu, unveröffentlicht) vor Mika. Die Vorgabe „wer am längsten wartet“
    // hinge am Seed, der beide in derselben Millisekunde anfordern kann – dann entschiede der Name.
    await page.goto('/animals?review=1&sort=name&dir=desc');
    const pelle = page.getByTestId('animal-row').filter({ hasText: 'Pelle' });
    const thumb = await pelle.locator('img').getAttribute('src');
    await page.getByTestId('animal-row').first().getByRole('link', { name: 'Pelle' }).click();
    await expect(page.getByText('1 von 2')).toBeVisible();
    await expect(page.getByText(/Prüfung offen seit/)).toBeVisible();
    await expect(page.getByText('neu', { exact: true })).toBeVisible(); // die Notiz
    await expect(page.getByLabel('Beim Bestätigen veröffentlichen')).toBeChecked();
    // Der Haken ändert keinen Datensatz, er wirkt nur beim Bestätigen: Er zählt nie als Änderung.
    await page.getByLabel('Beim Bestätigen veröffentlichen').uncheck();
    await page.getByLabel('Name').fill('Pelle');
    await expect(page.getByText('noch nicht gespeichert')).toHaveCount(0);
    await page.getByLabel('Name').fill('Pelle II');
    await expect(page.getByText('1 Änderung noch nicht gespeichert')).toBeVisible();
    await page.getByLabel('Name').fill('Pelle');
    await page.getByLabel('Beim Bestätigen veröffentlichen').check();
    await expect(page.getByText('noch nicht gespeichert')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await page.locator('[name="summary.de"]').fill('Von Hand geprüfter Kurztext.');
    const photos = page.getByTestId('animal-photo');
    await expect(photos).toHaveCount(3);
    await photos.nth(1).getByRole('button', { name: 'Hauptfoto' }).click();
    await photos.last().getByRole('button', { name: 'Entfernen' }).click();
    await page.getByRole('button', { name: 'Geprüft und weiter' }).click();

    // Pelle fällt mit dem Bestätigen aus der Auswahl; das Ziel stand schon beim Rendern fest.
    await expect(page.getByRole('heading', { name: 'Mika' })).toBeVisible();
    await expect(page).toHaveURL(/review=1/);
    await expect(page).toHaveURL(/tab=content/);
    await expect(page.getByRole('tab', { name: 'Texte und Fotos' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('1 von 1')).toBeVisible();
    // Mika ist schon veröffentlicht: kein Haken, und die Fotos sind ihre eigenen, nicht Pelles Auswahl.
    await expect(page.getByLabel('Beim Bestätigen veröffentlichen')).toHaveCount(0);
    await expect(page.getByTestId('animal-photo')).toHaveCount(3);

    await page.goto('/animals');
    await expect(pelle.getByRole('switch')).toBeChecked();
    await expect(pelle).not.toContainText('Prüfung offen');
    await expect(pelle.getByRole('cell').nth(5)).toHaveText('2'); // Fotozahl (Zelle 0 ist das Kästchen der Auswahl)
    expect(await pelle.locator('img').getAttribute('src')).not.toBe(thumb); // neues Hauptfoto
    await expect(page.getByRole('link', { name: /^Prüfung offen \(1\)$/ })).toBeVisible();
    await pelle.getByRole('link', { name: 'Pelle' }).click();
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await expect(page.locator('[name="summary.de"]')).toHaveValue('Von Hand geprüfter Kurztext.');
  });

  /**
   * Backlog 20: Am 13.09. drehte eine offene Maske sechs Texte zurück, die ein
   * Agent zwei Minuten vorher über MCP geschrieben hatte. Nachgestellt mit zwei
   * Fenstern: Das zweite speichert dazwischen, das erste wird abgewiesen.
   */
  test('weist ein Speichern auf veraltetem Stand ab und lässt die Änderung dazwischen stehen', async ({ page }) => {
    await page.goto('/animals/new');
    await page.getByLabel('Name').fill('Mira');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    const url = page.url();
    await page.reload();
    // `reload` wartet nicht auf die Hydration wie `goto` über die Fixture; ein
    // Klick auf einen Reiter davor verpufft (lokal so am 2026-09-19 grün
    // gelaufen, im CI rot).
    await expect(page.locator('html[data-hydrated="true"]')).toBeAttached();

    const other = await page.context().newPage();
    await other.goto(url);
    // Die zweite Seite läuft nicht über die Fixture, ihr `goto` wartet nicht auf React (wie contacts.spec.ts).
    await other.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
    await other.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await other.locator('[name="summary.de"]').fill('Aus dem zweiten Fenster.');
    await other.getByRole('button', { name: 'Speichern' }).click();
    await expect(other.getByText('Gespeichert').first()).toBeVisible();

    await page.getByLabel('Name').fill('Mira aus dem ersten Fenster');
    await page.getByRole('button', { name: 'Speichern' }).click();
    // Der Konflikt steht über der Leiste (Text ohne Person und Uhrzeit, weil der Dienst sie nicht nennt).
    await expect(page.locator('[data-slot="form-action-bar"]').getByRole('alert')).toContainText('wurde inzwischen geändert');
    await expect(page.getByLabel('Name')).toHaveValue('Mira aus dem ersten Fenster');

    await page.reload();
    await expect(page.locator('html[data-hydrated="true"]')).toBeAttached();
    await expect(page.getByLabel('Name')).toHaveValue('Mira');
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await expect(page.locator('[name="summary.de"]')).toHaveValue('Aus dem zweiten Fenster.');

    await page.getByRole('tab', { name: 'Steckbrief' }).click();
    await page.getByLabel('Name').fill('Mira, frisch geladen');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Gespeichert').first()).toBeVisible();
    await other.close();
  });

  test('behält die Eingaben, wenn das Speichern scheitert', async ({ page }) => {
    await page.goto('/animals/new');
    // Ein Name über 80 Zeichen: Der Server lehnt ab, der Browser lässt es durch. Geprüft wird gerade das Feld
    // mit der Meldung — es verlor bis 2026-10-05 seine Eingabe, weil FormField es beim ersten Fehler neu aufbaute.
    const name = 'Ein Name, der mühsam getippt wurde und für das Feld leider viel zu lang geraten ist, xxxx';
    await page.getByLabel('Name').fill(name);
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await page.locator('[name="summary.de"]').fill('Ein Text, der nicht verloren gehen darf.');
    await page.getByRole('button', { name: 'Speichern' }).click();

    await expect(page).toHaveURL(/\/animals\/new/);
    await page.getByRole('tab', { name: 'Steckbrief' }).click();
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Name')).toHaveValue(name);
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await expect(page.locator('[name="summary.de"]')).toHaveValue('Ein Text, der nicht verloren gehen darf.');
  });

  test('the story tab is locked until the dog is adopted', async ({ page }) => {
    await page.goto('/animals/new');
    await page.getByLabel('Name').fill('Bruno');
    await page.getByLabel('Geschlecht').selectOption('male');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await expect(page.getByText('Erst nach der Vermittlung')).toBeVisible();
  });

  test('übernimmt das Vermittlungsjahr aus „Status ändern“ in die Geschichte, ohne es beim Speichern zu überschreiben', async ({ page }) => {
    await page.goto('/animals/new');
    await page.getByLabel('Name').fill('Greta');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    await page.getByRole('button', { name: 'Status ändern' }).click();
    await page.getByRole('dialog').getByLabel('Neuer Status').selectOption('adopted');
    await page.getByRole('dialog').getByLabel('Vermittlungsjahr').fill('2024');
    await page.getByRole('dialog').getByRole('button', { name: 'Status setzen' }).click();
    await expect(page.getByRole('status')).toContainText('Status gesetzt');
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    const year = page.locator('[name="adoptedYear"]');
    await expect(year).toHaveValue('2024');
    // Das neu geladene Jahr ist keine Änderung: Nur die Familie zählt.
    await page.getByLabel('Familie', { exact: true }).fill('Familie G.');
    await expect(page.getByText('1 Änderung noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await expect(page.getByText('noch nicht gespeichert')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('html[data-hydrated="true"]')).toBeAttached();
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await expect(year).toHaveValue('2024');
  });

  test('unchecking a photo in the chooser removes it from the list', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await expect(page).toHaveURL(/\/animals\/new/);
    await page.getByLabel('Name').fill('Bo');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();

    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    let chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles([
      { name: 'bo-1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'bo-2.svg', mimeType: 'image/svg+xml', buffer: SVG },
    ]);
    await expect(chooser.getByText('2 von 12 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(2);

    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByRole('button', { name: /bo-2-/ }).click();
    await expect(chooser.getByText('1 von 12 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(1);
  });

  /**
   * Befund 6 (0.2.4): Auf Prod führte das 13. Foto zu „Ein Feld braucht noch eine Angabe.“ — nichts fehlte,
   * es war eines zu viel, und am Feld stand nichts. Jetzt sperrt der Dialog an der Grenze, und kommt doch
   * ein 13. an (hier per manipuliertem Formularzustand), nennen Fehlerbox und Editor die Meldung.
   */
  test('lässt kein 13. Foto zu und nennt die Grenze, wenn doch eines ankommt', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await expect(page).toHaveURL(/\/animals\/new/);
    await page.getByLabel('Name').fill('Dreizehn');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await expect(page.getByText('0 von 12 Fotos')).toBeVisible();

    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    // 13 verschiedene Bilder: Gleicher Inhalt würde als schon vorhanden erkannt.
    const files = Array.from({ length: 13 }, (_, i) => ({
      name: `dreizehn-${i + 1}.svg`,
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${i + 2}" height="4"><rect width="${i + 2}" height="4"/></svg>`),
    }));
    await chooser.getByLabel('Hochladen').setInputFiles(files);
    // Hochgeladen werden alle 13, angehakt nur 12; der Rest ist gesperrt, mit Grund.
    await expect(chooser.getByText('12 von 12 ausgewählt')).toBeVisible();
    await expect(chooser.getByRole('button', { name: /dreizehn-/ })).toHaveCount(13);
    const spare = chooser.locator('[data-asset-id][aria-pressed="false"]').filter({ hasText: 'dreizehn-' });
    await expect(spare).toHaveCount(1);
    await expect(spare).toBeDisabled();
    await expect(spare).toHaveAccessibleDescription(/Höchstens 12/);
    const spareId = await spare.getAttribute('data-asset-id');
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.getByTestId('animal-photo')).toHaveCount(12);
    await expect(page.getByText('12 von 12 Fotos')).toBeVisible();

    // Am Dialog vorbei: das 13. direkt in den Formularzustand.
    await page.locator('input[name="photos"]').evaluate((input: HTMLInputElement, id) => {
      input.value = JSON.stringify([...JSON.parse(input.value), { assetId: id, isPrimary: false }]);
    }, spareId);
    await page.getByRole('button', { name: 'Speichern' }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Bitte prüfen Sie ein Feld:' });
    await expect(summary).toContainText('Fotos: Höchstens 12 Fotos. Entfernen Sie eines, bevor Sie ein neues hinzufügen.');
    await expect(summary).not.toContainText('Angabe');
    await expect(page.getByRole('tabpanel', { name: 'Texte und Fotos' }).getByText('Höchstens 12 Fotos. Entfernen Sie eines, bevor Sie ein neues hinzufügen.', { exact: true })).toBeVisible();
  });

  test('löscht einen Hund in zwei Stufen und nimmt die nur hier verwendeten Fotos mit', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await expect(page).toHaveURL(/\/animals\/new/);
    await page.getByLabel('Name').fill('Partnerhund');
    await page.getByLabel('Geschlecht').selectOption('male');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    const detailUrl = page.url();

    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles([{ name: 'partnerhund.png', mimeType: 'image/png', buffer: PNG }]);
    await expect(chooser.getByText('1 von 12 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(chooser).toBeHidden();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');

    // Veröffentlichen, dann zeigt der Dialog die erste Stufe.
    await page.goto('/animals');
    const publish = page.getByRole('row', { name: /Partnerhund/ }).getByRole('switch');
    await publish.click();
    await expect(publish).toBeChecked();

    await page.goto(detailUrl);
    await page.getByRole('button', { name: 'Tierprofil löschen' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Partnerhund löschen?' });
    await expect(dialog.getByText('Das ist noch veröffentlicht.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Löschen' })).toBeDisabled();

    await dialog.getByRole('button', { name: 'Zurückziehen' }).click();
    await expect(dialog.getByText('Der Inhalt wird entfernt.')).toBeVisible();
    await expect(dialog.getByText('Das eine Foto, das nur hier verwendet wird, mitlöschen')).toBeVisible();
    await dialog.getByRole('button', { name: 'Löschen' }).click();

    await expect(page).toHaveURL(/\/animals$/);
    await expect(page.getByRole('row', { name: /Partnerhund/ })).toHaveCount(0);
    await page.goto('/admin/media');
    await expect(page.getByRole('row', { name: /partnerhund-/ })).toHaveCount(0);
  });
  /**
   * Befund Joe, 2026-09-30: Fällt der Hund in der Maske aus dem Filter der Liste, aus der man kam (hier: er wird
   * veröffentlicht und gespeichert), verschwand „Speichern und weiter“ – man saß im Eintrag fest.
   */
  test('behält „weiter“, wenn der Hund in der Maske aus dem Filter fällt', async ({ page }) => {
    await page.goto('/animals?published=0');
    await page.getByRole('link', { name: 'Frida' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+\?published=0/);
    await expect(page.getByText('1 von 3')).toBeVisible();
    const publish = page.getByRole('switch', { name: 'Veröffentlicht' });
    await publish.click();
    await expect(publish).toBeChecked();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await expect(page.getByText('1 von 3')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern und weiter' }).click();
    await expect(page.getByRole('heading', { name: 'Nala' })).toBeVisible();
  });
  /** Befund Joe, 2026-09-30: Ein Klick auf „Tiere“ in der Seitenleiste nahm den Filter zurück, die Felder zeigten ihn aber weiter. */
  test('die Filterfelder folgen der Adresse, auch wenn sie von außen wechselt', async ({ page }) => {
    await page.goto('/animals');
    await page.getByLabel('Webseite', { exact: true }).selectOption('0');
    await page.getByPlaceholder('Name suchen').fill('a');
    await expect(page).toHaveURL(/text=a&published=0/);
    await page.getByRole('navigation').getByRole('link', { name: 'Tiere' }).first().click();
    await expect(page).toHaveURL(/\/animals$/);
    await expect(page.getByTestId('animal-row')).toHaveCount(6);
    await expect(page.getByLabel('Webseite', { exact: true })).toHaveValue('');
    await expect(page.getByPlaceholder('Name suchen')).toHaveValue('');
  });
  /**
   * Befund Joe, 2026-09-30: Die Webseite zeigt das Hauptfoto hoch (4:5, Blickpunkt oben), die Maske zeigte quer.
   * Beim Wählen des Hauptfotos war nicht zu sehen, was die Seite zeigt. Das Format ist eine Einstellung.
   */
  test('zeigt die Fotos im eingestellten Ausschnitt der Webseite', async ({ page }) => {
    await page.goto('/admin/animals');
    await page.getByLabel('Seitenverhältnis').selectOption('4:5');
    await page.getByLabel('Blickpunkt senkrecht (%)').fill('25');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Einstellungen gespeichert');

    await page.goto('/animals');
    await page.getByRole('link', { name: 'Pelle' }).click();
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    const photo = page.getByTestId('animal-photo').first().locator('img');
    await expect(photo).toHaveCSS('aspect-ratio', '4 / 5');
    await expect(photo).toHaveCSS('object-position', '50% 25%');
  });

  /** Spec 2026-10-05: Mappe aus der gefilterten Liste, Einzelblatt aus der Maske. Kein Layout-Test des PDFs. */
  test('exportiert die gefilterte Liste und einen Hund als PDF', async ({ page }) => {
    await page.goto('/animals');
    await page.getByLabel('Status', { exact: true }).selectOption('lookingForHome');
    await page.getByLabel('Webseite', { exact: true }).selectOption('1');
    await expect(page.getByText('2 von 6 Hunden')).toBeVisible();

    // Review Focus 1: Das Kästchen kreuzt an und öffnet den Hund nicht.
    await page.getByRole('checkbox', { name: 'Mika auswählen' }).click();
    await expect(page).toHaveURL(/\/animals\?/);
    await expect(page.getByTestId('selection-bar')).toContainText('1 Hund ausgewählt');

    await page.getByRole('checkbox', { name: 'Alle gezeigten Hunde auswählen' }).click();
    await expect(page.getByTestId('selection-bar')).toContainText('2 Hunde ausgewählt');
    const [mappe] = await Promise.all([page.waitForEvent('download'), page.getByTestId('animals-export').click()]);
    expect(mappe.suggestedFilename()).toMatch(/^Hundeprofile \d{4}-\d{2}-\d{2}\.pdf$/);
    const bytes = await readFile((await mappe.path())!);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(bytes.byteLength).toBeGreaterThan(10_000);

    // Review Focus 2: Ein anderer Filter ist eine neue Liste.
    await page.getByLabel('Webseite', { exact: true }).selectOption('');
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);

    await page.getByRole('link', { name: 'Mika' }).click();
    await expect(page.getByText(/https:\/\/musterverein\.example\/tiere\/mika-[0-9a-z]{4}\//)).toBeVisible();
    const [blatt] = await Promise.all([page.waitForEvent('download'), page.getByTestId('animals-export').click()]);
    expect(blatt.suggestedFilename()).toBe('Mika.pdf');
  });

  test('zeigt ohne Profiladresse keine Adresse unter dem Namen', async ({ page }) => {
    await setE2ESetting(page, 'animals.profileUrl', '');
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Mika' }).click();
    await expect(page.getByRole('heading', { name: 'Mika' })).toBeVisible();
    await expect(page.getByText('musterverein.example')).toHaveCount(0);
  });
});
