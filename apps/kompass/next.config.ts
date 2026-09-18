import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

// Die Fassung des Produkts steht an genau einer Stelle. Von hier reicht sie
// der Bau weiter — an /api/health und in den Fuss der Schiene.
const { version } = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8'),
) as { version: string };

const nextConfig: NextConfig = {
  env: { KOMPASS_VERSION: version },
  transpilePackages: [
    '@kompass/core',
    '@kompass/documents',
    '@kompass/mcp',
    '@kompass/module-site',
    '@kompass/module-animals',
    '@kompass/module-contacts',
    '@kompass/module-dms',
    '@kompass/markdown',
    '@kompass/text-extraction',
  ],
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2', 'tar', 'file-type', 'image-size', 'sharp'],
  // Backups enthalten Datenbank und Medien; die Vorgabe von 1 MB reicht dafür
  // nicht. Der Import läuft über eine Server Action, deren Body Next puffert,
  // deshalb bewusst begrenzt statt unbeschränkt.
  experimental: { serverActions: { bodySizeLimit: '512mb' } },
  // Next blockiert im Entwicklungsmodus Anfragen an /_next/* von anderen
  // Ursprüngen als dem Starthost. Der Browser löst localhost je nach System
  // auf 127.0.0.1 auf, und dann trifft genau das den eigenen Rechner.
  allowedDevOrigins: ['127.0.0.1'],
  // Die Schiene hat jetzt einen Bereich „Einstellungen“ unten links, genau wo
  // der Next-Entwicklungsindikator sonst sitzt (`position: 'bottom-left'`,
  // Vorgabe) — er nimmt der Zeile die Klicks weg. Rein visuell, ohne
  // Wirkung auf Prod-Build oder die Fehleranzeige.
  devIndicators: { position: 'bottom-right' },
  // Die Anwendung laeuft nach Zielbild im eigenen Netz. Das ist eine
  // Betriebsannahme, kein Schutz: Sobald jemand einen Reverse Proxy davorstellt
  // — der wahrscheinlichste Weg, sie doch erreichbar zu machen —, zaehlt jede
  // dieser Zeilen. Sie kosten nichts.
  //
  // Bewusst ohne `script-src` und `style-src`: Das Wurzel-Layout traegt ein
  // Inline-`<style>` mit den Theme-Tokens und einen Inline-Bootstrap fuer
  // Farbschema und Dichte (`src/app/layout.tsx`). Beide zu erlauben verlangte
  // Nonces durch die ganze Kette; was hier steht, beruehrt weder Skripte noch
  // Stile und kann deshalb nichts brechen. Wer spaeter `script-src` will,
  // faengt bei der Nonce im Layout an.
  //
  // Bewusst ohne HSTS: Die Installation laeuft im LAN ueber http. Ein Browser,
  // der sich HSTS gemerkt hat, erreicht sie danach gar nicht mehr.
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        // Fuer Browser, die `frame-ancestors` noch nicht kennen.
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        // Sonst tragen interne Pfade wie /dms/<ULID> in fremde Protokolle,
        // sobald jemand einem Link nach draussen folgt.
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
      ],
    },
    {
      // Ueberall ausser auf den drei Routen, die hochgeladene Dateien
      // ausliefern: Die setzen `content-security-policy: sandbox` selbst, und
      // eine Kopfzeile von hier gewinnt gegen die der Route. Ein globaler CSP
      // naehme ihnen die Sandbox — also genau den Schutz davor, dass ein
      // hochgeladenes SVG im Ursprung der Anwendung laeuft. Die E2E-Suite
      // haelt das fest (`media.spec.ts`), `tests/security-headers.test.ts`
      // ebenso.
      source: '/((?!media/|help-bilder/).*)',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: ["frame-ancestors 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"].join('; '),
        },
      ],
    },
  ],
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
};

export default withNextIntl(nextConfig);
