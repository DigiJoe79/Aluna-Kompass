import { expect, test } from './fixtures';

/**
 * `tests/security-headers.test.ts` prueft die Konfiguration. Ob Next sie auch
 * ausliefert, zeigt erst eine echte Antwort — und dass beides
 * auseinanderlaufen kann, hat der 15.09. gezeigt: Ein globaler CSP nahm den
 * Medienrouten ihre Sandbox, ohne dass ein Unit-Test es merkte.
 */
test('an ordinary page carries the policy', async ({ page }) => {
  const antwort = await page.request.get('/login');
  expect(antwort.status()).toBe(200);
  const k = antwort.headers();
  expect(k['content-security-policy']).toContain("frame-ancestors 'self'");
  expect(k['x-frame-options']).toBe('SAMEORIGIN');
  expect(k['x-content-type-options']).toBe('nosniff');
  expect(k['referrer-policy']).toBe('same-origin');
  // Die Installation laeuft im LAN ueber http; ein gemerkter HSTS-Eintrag
  // machte sie fuer den Browser danach unerreichbar.
  expect(k['strict-transport-security']).toBeUndefined();
});
