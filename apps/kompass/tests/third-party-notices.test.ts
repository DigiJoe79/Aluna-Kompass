import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

/**
 * Wer ein Paket ins Laufzeit-Image aufnimmt, verteilt fremde Software mit.
 * Die meisten Debian-Pakete stehen unter GPL oder LGPL, und beide verlangen,
 * dass der Empfaenger erfaehrt, was er bekommen hat und woher der Quellcode
 * kommt. Dieser Waechter haelt die Uebersicht `THIRD-PARTY-NOTICES.md` an der
 * Wirklichkeit: Ein neues `apt-get install` ohne Eintrag wird rot.
 *
 * Die vollstaendige Liste mit Versionen entsteht beim Bau im Image; ob sie
 * dort liegt und jede npm-Lizenz freigegeben ist, prueft
 * `scripts/third-party-notices.sh --pruefen` gegen das gebaute Image.
 */
const runtimePackages = (): string[] => {
  const dockerfile = read('Dockerfile');
  // Nur die Laufzeitstufe zaehlt: was `deps` und `build` installieren, bleibt dort.
  const runner = dockerfile.slice(dockerfile.indexOf('AS runner'));
  const installed = [...runner.matchAll(/apt-get install -y --no-install-recommends ([^&\\]+)/g)]
    .flatMap((m) => (m[1] ?? '').split(/\s+/))
    .filter(Boolean);
  // Was im selben Schritt wieder entfernt wird, liegt am Ende nicht im Image.
  const purged = [...runner.matchAll(/apt-get purge -y ([^&\\]+)/g)].flatMap((m) => (m[1] ?? '').split(/\s+/)).filter(Boolean);
  return installed.filter((pkg) => !purged.includes(pkg));
};

describe('third-party notices', () => {
  it('names every package the runtime image installs', () => {
    const notices = read('THIRD-PARTY-NOTICES.md');
    const missing = runtimePackages().filter((pkg) => !notices.includes(pkg));
    expect(missing).toEqual([]);
  });

  /**
   * Ein Drittel der Debian-Pakete traegt seine Lizenz noch als Freitext statt
   * im maschinenlesbaren Format. Genau dort steckt Copyleft: `rsync` verweist
   * im Fliesstext auf `/usr/share/common-licenses/GPL-3`. Eine Aufstellung,
   * die solche Pakete unbestimmt laesst, verfehlt ihren Zweck.
   */
  it('resolves the licence even where the copyright file is free text', () => {
    const notices = read('THIRD-PARTY-NOTICES.md');
    const rsync = notices.split('\n').find((line) => line.startsWith('| `rsync` |'));
    expect(rsync).toBeDefined();
    expect(rsync).toMatch(/GPL-3/);
  });

  /**
   * Die vollständige Aufstellung mit Versionen entsteht beim Bau im Image
   * (`/app/THIRD-PARTY-NOTICES.md`). Stand sie mit Versionen im Repo, machte
   * jedes Dependabot-Update sie falsch — und jeder seiner Pull Requests wurde
   * an genau dieser Stelle rot, erstmals mit #5 am 2026-09-16. Die Datei im
   * Repo ist deshalb eine Übersicht ohne Versionsnummern.
   */
  it('carries no version numbers, so an update cannot make it stale', () => {
    const notices = read('THIRD-PARTY-NOTICES.md');
    const mitVersion = notices.split('\n').filter((zeile) => /^\| `[^`]+` \| `[^`]*\d[^`]*` \|/.test(zeile));
    expect(mitVersion).toEqual([]);
  });

  it('says where the complete list with versions lives', () => {
    const notices = read('THIRD-PARTY-NOTICES.md');
    expect(notices).toContain('/app/THIRD-PARTY-NOTICES.md');
    // Und der Bau legt sie dort wirklich an.
    expect(read('Dockerfile')).toMatch(/third-party-notices\.sh --erzeugen > \/app\/THIRD-PARTY-NOTICES\.md/);
  });

  /** Eigener Code ist keine Software Dritter und steht unter der Projektlizenz. */
  it('does not list the project itself as third-party software', () => {
    const notices = read('THIRD-PARTY-NOTICES.md');
    expect(notices).not.toMatch(/\| `(@kompass\/[^`]+|verein-basis)` \|/);
  });

  it('says where the source of the copylefted parts can be had', () => {
    const notices = read('THIRD-PARTY-NOTICES.md');
    // snapshot.debian.org haelt die exakte Paketfassung dauerhaft vor, anders
    // als die rollende Distribution — ein Verweis dorthin bleibt gueltig.
    expect(notices).toContain('snapshot.debian.org');
    expect(notices).toMatch(/libvips/i);
  });

  it('carries a written offer, so the commercial question need not be decided', () => {
    const notices = read('THIRD-PARTY-NOTICES.md');
    expect(notices).toMatch(/drei Jahre/i);
  });

  /**
   * Das schriftliche Angebot taugt nur, solange der Weg dorthin existiert.
   * Es verweist auf das README, das README auf SECURITY.md — faellt ein Glied
   * weg, zeigt das Angebot ins Leere, ohne dass es jemandem auffiele.
   */
  it('offers a source contact the README actually names', () => {
    expect(read('THIRD-PARTY-NOTICES.md')).toMatch(/README/);
    const readme = read('README.md');
    expect(readme).toMatch(/SECURITY\.md/);
    expect(read('SECURITY.md')).toMatch(/Sicherheitslücke|Schwachstelle/);
  });

  it('is announced in NOTICE, where Apache-2.0 expects it', () => {
    expect(read('NOTICE')).toContain('THIRD-PARTY-NOTICES');
  });
});
