import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * Der Mechanismus hinter vier roten Läufen — hier absichtlich ausgelöst.
 *
 * Eine Taste wirkt erst, wenn React die Handler angehängt hat. Bis dahin steht
 * die Seite vollständig da: servergerendert, sichtbar, ohne jede Wirkung. In
 * diese Lücke fielen `help.spec.ts`, `media.spec.ts` und dreimal der Betreff im
 * DMS-Empfangsdialog.
 *
 * Zwei Wege hierher führten nicht zum Ziel, beide gemessen:
 *
 * - **Chunks bremsen allein** reicht nicht. `page.goto` wartet auf `load`, und
 *   das schliesst die verzögerten Skripte ein — 30 gebremste Anfragen, Test
 *   blieb grün.
 * - **Den Renderer drosseln** reicht auch nicht, obwohl es das Fenster
 *   nachweislich öffnet (gemessen: 0 ms ungedrosselt, 330 ms bei `rate: 20`).
 *   Die Drosselung trifft die Verarbeitung des Tastendrucks mit, der dadurch
 *   erst nach der Hydration ankommt. Auf dem CI-Läufer ist allein der Browser
 *   langsam, der Testprozess nicht — deshalb trifft er das Fenster dort.
 *
 * Also beides getrennt: `waitUntil: 'commit'` kehrt zurück, sobald die Seite
 * steht, statt auf die Skripte zu warten; die Bremse hält allein die Hydration
 * auf. Der Tastendruck läuft ungebremst — genau die Lage auf dem Läufer.
 */
test.describe('Hydration', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('eine Taste unmittelbar nach dem Seitenwechsel kommt an', async ({ page }) => {
    await page.route('**/_next/static/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });

    await page.goto('/contacts', { waitUntil: 'commit' });
    await page.keyboard.press('Shift+?');

    await expect(page.getByTestId('help-panel')).toBeVisible();
  });
});
