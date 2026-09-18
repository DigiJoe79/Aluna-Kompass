import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

/**
 * Der Beweis, den ein Unit-Test nicht fuehren kann: Die Nummer aus der
 * `package.json` im Wurzelverzeichnis kommt ueber `next.config.ts` bis in die
 * Antwort von /api/health. Ein Betreiber liest sie dort, ein Fehlerbericht
 * nennt sie, und ein Update laesst sich daran pruefen.
 */
test('the health endpoint reports the declared product version', async ({ page }) => {
  const wurzel = path.resolve(import.meta.dirname, '../../..');
  const { version } = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8')) as { version: string };

  const antwort = await page.request.get('/api/health');
  expect(antwort.status()).toBe(200);
  const koerper = (await antwort.json()) as { version: string; build: string; status: string };
  expect(koerper.status).toBe('ok');
  expect(koerper.version).toBe(version);
  expect(koerper.version).not.toBe('0.0.0-dev');
});
