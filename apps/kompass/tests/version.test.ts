import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appVersion } from '@/lib/build';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const paket = (p: string): { version?: string } => JSON.parse(readFileSync(path.join(ROOT, p, 'package.json'), 'utf8'));

const PAKETE = [
  'apps/kompass',
  'packages/core',
  'packages/documents',
  'packages/markdown',
  'packages/mcp',
  'packages/site-template',
  'packages/text-extraction',
];

/**
 * Ein Betreiber muss sagen koennen, welche Fassung er faehrt, und ein
 * Fehlerbericht braucht sie. Die Nummer steht deshalb an genau einer Stelle —
 * der `package.json` im Wurzelverzeichnis — und wird von dort weitergereicht.
 * Eine zweite Stelle laeuft irgendwann auseinander, und niemand merkt es.
 */
describe('the product version', () => {
  it('is declared at the root, in semver', () => {
    expect(paket('.').version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('is the same in every package of the workspace', () => {
    const abweichend = PAKETE.filter((p) => paket(p).version !== paket('.').version);
    expect(abweichend).toEqual([]);
  });

  /**
   * Vitest fuehrt `next.config.ts` nicht aus, kann also nicht beweisen, dass
   * die Nummer wirklich ankommt — das tut `e2e/version.spec.ts` an der echten
   * Antwort von /api/health. Hier steht nur, dass die Konfiguration sie aus
   * der `package.json` nimmt und nicht aus einer zweiten Quelle.
   */
  it('is fed into the build from that one declaration', () => {
    const config = readFileSync(path.join(ROOT, 'apps/kompass/next.config.ts'), 'utf8');
    expect(config).toContain('KOMPASS_VERSION');
    expect(config).toMatch(/package\.json/);
    expect(config).not.toMatch(/KOMPASS_VERSION:\s*['"`]\d/);
  });

  it('falls back to something nobody mistakes for a release', () => {
    delete process.env.KOMPASS_VERSION;
    expect(appVersion()).toBe('0.0.0-dev');
    process.env.KOMPASS_VERSION = paket('.').version;
    expect(appVersion()).toBe(paket('.').version);
  });

  /**
   * Eine Fassung ohne Eintrag ist fuer den Betreiber eine Fassung ohne Grund:
   * Er soll vor einem Update lesen koennen, was sich aendert. Der Eintrag
   * entsteht deshalb mit der Nummer, nicht danach.
   *
   * Waehrend eines Zyklus traegt der Branch eine Vorabnummer (`0.1.1-dev`),
   * damit die Testinstanz nicht die alte Fassung zu sein scheint (gefunden bei
   * der Abnahme von 0.1.1). Ihr Eintrag steht unter „Unveröffentlicht“; eine
   * Abschnittsnummer bekommt erst die ausgelieferte Fassung.
   */
  it('has a changelog entry under its own number', () => {
    const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const version = paket('.').version!;
    if (version.includes('-')) {
      expect(changelog).toContain('## [Unveröffentlicht]');
      expect(changelog, 'eine Vorabnummer ist nie ausgeliefert').not.toContain(`## [${version}]`);
    } else {
      expect(changelog).toContain(`## [${version}]`);
    }
  });


  /**
   * Der Health-Endpunkt trug die Nummer als Zeichenkette im Code. Beides war
   * zufaellig gleich und waere beim ersten Hochziehen auseinandergelaufen.
   */
  it('appears nowhere as a literal in the code that reports it', () => {
    const route = readFileSync(path.join(ROOT, 'apps/kompass/src/app/api/health/route.ts'), 'utf8');
    expect(route).not.toMatch(/\d+\.\d+\.\d+/);
  });
});
