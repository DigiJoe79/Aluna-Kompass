import { describe, expect, it } from 'vitest';
import config from '../next.config';

/**
 * Die Anwendung laeuft nach Zielbild im eigenen Netz — aber das ist eine
 * Betriebsannahme, kein Schutz, und der erste Satz, der nach einer
 * Veroeffentlichung nicht mehr stimmt. Diese Kopfzeilen kosten nichts und
 * tragen genau dann, wenn jemand einen Reverse Proxy davorstellt.
 *
 * Bewusst **nicht** gesetzt: `script-src` und `style-src`. Das Wurzel-Layout
 * traegt ein Inline-`<style>` mit den Theme-Tokens und einen Inline-Bootstrap
 * fuer Farbschema und Dichte; beide zu erlauben verlangte Nonces durch die
 * ganze Kette. Was hier steht, beruehrt weder Skripte noch Stile und kann
 * deshalb nichts brechen.
 *
 * Ebenfalls bewusst nicht gesetzt: HSTS. Die Installation laeuft im LAN ueber
 * http; ein Browser, der sich HSTS merkt, erreicht sie danach gar nicht mehr.
 */
/** `source` ist path-to-regexp: `/:path*` faengt alles, eine Klammergruppe ist roher Regex. */
const gilt = (source: string, pfad: string): boolean =>
  source === '/:path*' ? true : new RegExp(`^${source}$`).test(pfad);

/** Alle Kopfzeilen, die fuer diesen Pfad greifen — wie Next sie zusammenlegt. */
const kopfzeilen = async (pfad = '/dms'): Promise<Record<string, string>> => {
  const regeln = await config.headers!();
  const passend = regeln.filter((regel) => gilt(regel.source, pfad));
  return Object.fromEntries(passend.flatMap((regel) => regel.headers.map((h) => [h.key.toLowerCase(), h.value])));
};

/**
 * Drei Routen liefern hochgeladene Dateien aus und setzen dafuer selbst
 * `content-security-policy: sandbox` — die einzige Verteidigung dagegen, dass
 * ein hochgeladenes SVG im Ursprung der Anwendung laeuft. Eine Kopfzeile aus
 * `next.config` gewinnt gegen die der Route: Ein globaler CSP nimmt ihnen die
 * Sandbox, ohne dass es auffiele. Deshalb gilt der CSP hier ueberall ausser
 * dort; die uebrigen Kopfzeilen kollidieren nicht und bleiben global.
 */
const AUSGELIEFERTE_DATEIEN = ['/media/01ABC', '/media/01ABC/preview', '/help-bilder/einstieg/oberflaeche.png'];

const cspFuer = async (pfad: string): Promise<string | undefined> =>
  (await kopfzeilen(pfad))['content-security-policy'];

describe('security headers', () => {
  it('leaves the sandbox of the file-serving routes alone', async () => {
    for (const pfad of AUSGELIEFERTE_DATEIEN) {
      expect(await cspFuer(pfad), `${pfad} darf keinen CSP aus next.config bekommen`).toBeUndefined();
    }
  });

  it('still covers ordinary pages with the policy', async () => {
    expect(await cspFuer('/dms')).toContain("frame-ancestors 'self'");
    expect(await cspFuer('/')).toContain("frame-ancestors 'self'");
  });

  it('refuses to be framed by a foreign page', async () => {
    const h = await kopfzeilen();
    expect(h['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('closes the openings that need no script policy', async () => {
    const csp = (await kopfzeilen())['content-security-policy'] ?? '';
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it('keeps the browser from guessing types and from leaking paths', async () => {
    const h = await kopfzeilen();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('same-origin');
  });

  /** Ein Browser, der sich HSTS merkt, erreicht eine LAN-Instanz ohne TLS nicht mehr. */
  it('does not force https on an installation that runs without it', async () => {
    expect(await kopfzeilen()).not.toHaveProperty('strict-transport-security');
  });
});
