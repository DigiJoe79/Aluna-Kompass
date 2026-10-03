import type { Deps } from '@kompass/core';

/**
 * Nur für E2E. Warm baut das Basis-Template in unter einer Sekunde, zu schnell,
 * um einen Lauf abzubrechen. Ein Test setzt über `/__e2e/site-brake` eine
 * Wartezeit; sie hält den Export am Anfang fest. Nur in der Umgebung `test`
 * und nur, wenn ein Wert gesetzt ist — überall sonst ohne Wirkung.
 */
export async function siteTestBrake(deps: Pick<Deps, 'env'>, signal?: AbortSignal): Promise<void> {
  const ms = deps.env === 'test' ? ((globalThis as { __kompassSiteTestBrakeMs?: number }).__kompassSiteTestBrakeMs ?? 0) : 0;
  if (ms <= 0 || signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
