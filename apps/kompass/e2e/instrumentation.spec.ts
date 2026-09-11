import { expect, test } from '@playwright/test';

/**
 * Der Haken ist die einzige Zusicherung dieser Spec, die nicht aus einer
 * Messung stammt. Er bekommt deshalb einen Test, der gegen den echten Server
 * läuft: `/api/health` meldet, ob die Hintergrundarbeit angelaufen ist.
 */
test('der Server hat seine Hintergrundarbeit angelassen', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ background: true });
});
