import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isoDay, type DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentEngine, createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';

/**
 * Die optionale Anschriftzone der Formular-Basis (Plan 2026-09-27): Liefert
 * die Vorlage `slots.recipient`, zeichnet die Basis auf Seite 1 das
 * Anschriftfeld an derselben Stelle wie der Brief — für den Fensterumschlag.
 * Ohne `recipient` bleibt die Seite, wie sie war.
 */
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-zone-'));
  dirs.push(d);
  return d;
};

const bases = resolveBases(resolveAssetDirs({}));
const renderer = createTypstRenderer();
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

const payload = (slots: Record<string, unknown> = {}) => ({
  brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.street': 'Musterweg 1', 'organization.postalCode': '12345', 'organization.city': 'Musterstadt' },
  number: 'ZWB-2026-001',
  issuedDate: '05.09.2026',
  slots: { kind: 'form', title: 'Bestätigung', ...slots },
});

const render = (slots: Record<string, unknown> = {}, body = 'Körperanfang des Formulars.', set = bases) =>
  renderer.renderDocument({ baseId: 'a4-formular', bases: set, bodyTypst: body, payload: payload(slots) });

const ZONE = {
  recipient: 'Erika Musterfrau\nBeispielstraße 7\n54321 Beispielstadt',
  recipientLabel: 'Name und Anschrift des Zuwendenden:',
  infoBlock: '#text(size: 8pt)[Aussteller] #linebreak() #"Musterverein e.V.";',
};

const MM = 25.4 / 72;
/** Wörter mit ihrer Lage in Millimetern (Oberkante, linke Kante) — aus `pdftotext -bbox`. */
function words(bytes: Uint8Array): { word: string; x: number; y: number; page: number }[] {
  const dir = tmp();
  writeFileSync(path.join(dir, 'x.pdf'), bytes);
  const out = spawnSync('pdftotext', ['-bbox', path.join(dir, 'x.pdf'), '-'], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`pdftotext: ${out.stderr}`);
  const found: { word: string; x: number; y: number; page: number }[] = [];
  let page = 0;
  for (const line of out.stdout.split('\n')) {
    if (line.includes('<page ')) page += 1;
    const m = /<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/.exec(line);
    if (m) found.push({ word: m[3]!, x: Number(m[1]) * MM, y: Number(m[2]) * MM, page });
  }
  return found;
}
const at = (bytes: Uint8Array, word: string) => {
  const hit = words(bytes).find((w) => w.word === word);
  if (!hit) throw new Error(`word not found: ${word}`);
  return hit;
};

describe('a4-formular base: optional address zone', () => {
  it('declares the address zone in the manifest', () => {
    expect(bases.get('a4-formular')!.slots).toEqual(['recipient', 'recipientLabel', 'infoBlock']);
    expect(bases.get('a4-plain')!.slots).toEqual([]);
  });

  it('draws the address zone only when recipient is set', async () => {
    const plain = await render();
    expect(same(plain, await render({ recipientLabel: ZONE.recipientLabel, infoBlock: ZONE.infoBlock }))).toBe(true);
    const zone = await render(ZONE);
    expect(same(plain, zone)).toBe(false);
    // DIN 5008 Form B: Anschriftzone ab 62,7 mm von oben, Text 25 mm von links — im Fenster eines DIN-lang-Umschlags.
    // (pdftotext misst den Kegel: Oberkante knapp 2 mm über der Satzkante.)
    const name = at(zone, 'Erika');
    expect(name.page).toBe(1);
    expect(name.x).toBeGreaterThan(24);
    expect(name.x).toBeLessThan(26);
    expect(name.y).toBeGreaterThan(60.5);
    expect(name.y).toBeLessThan(63);
    // Der Informationsblock steht rechts daneben: 125 mm von links, 50 mm von oben.
    const info = at(zone, 'Aussteller');
    expect(info.x).toBeGreaterThan(124);
    expect(info.x).toBeLessThan(126);
    expect(info.y).toBeGreaterThan(48);
    expect(info.y).toBeLessThan(50.5);
  });

  it('puts the recipient label in the return-address line', async () => {
    const zone = await render(ZONE);
    const label = at(zone, 'Zuwendenden:');
    const name = at(zone, 'Erika');
    // In der Zusatz- und Vermerkzone (45–62,7 mm), unten, direkt über der Anschrift.
    expect(label.y).toBeGreaterThan(55);
    expect(label.y).toBeLessThan(name.y);
    expect(name.y - label.y).toBeLessThan(5);
    expect(at(zone, 'Name').x).toBeGreaterThan(24);
    expect(at(zone, 'Name').x).toBeLessThan(26);
  });

  it('keeps the body start fixed regardless of address lines', async () => {
    const short = await render({ ...ZONE, recipient: 'Erika Musterfrau' });
    const long = await render({ ...ZONE, recipient: 'Erika Musterfrau\nc/o Beispiel GmbH\nBeispielstraße 7\nHinterhaus\n54321 Beispielstadt' });
    const a = at(short, 'Körperanfang');
    const b = at(long, 'Körperanfang');
    expect(a.y).toBeCloseTo(b.y, 1);
    // Der Körper beginnt unter dem Fenster.
    // Der Körper beginnt 94 mm von oben, unter dem Anschriftfeld (Ende 90 mm).
    expect(a.y).toBeGreaterThan(92.3);
    expect(a.y).toBeLessThan(94);
    // Auch die fünfte Zeile bleibt im Feld.
    expect(at(long, 'Beispielstadt').y).toBeLessThan(86);
  });

  it('renders unchanged without recipient', async () => {
    const vol = tmp();
    copyFileSync(path.join(import.meta.dirname, 'fixtures', 'a4-formular-ohne-anschriftzone.typ'), path.join(vol, 'a4-formular.typ'));
    const old = resolveBases({ ...resolveAssetDirs({}), documentTemplatesDir: vol });
    expect(same(await render(), await render({}, undefined, old))).toBe(true);
    expect(same(await render({ draft: true }), await render({ draft: true }, undefined, old))).toBe(true);
    // Die alte Basis kennt die Zone nicht und trägt kein Kennzeichen.
    expect(old.get('a4-formular')!.slots).toEqual([]);
  });

  it('the engine tells the body which slots the base draws', async () => {
    const context: DocumentRenderContext = { number: 'ZWB-2026-001', issuedAt: '2026-09-05T08:00:00.000Z', issuedDay: isoDay('2026-09-05'), organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };
    const body = '#if json("/data.json").at("baseSlots", default: ()).contains("recipient") [ZONE-JA] else [ZONE-NEIN]';
    const render = (documentTemplatesDir: string | null) =>
      createDocumentEngine({ documentTemplatesDir }).render({ baseId: 'a4-formular', bodyTypst: body, slots: { kind: 'form', title: 'x' }, context });
    expect(words((await render(null)).bytes).map((w) => w.word)).toContain('ZONE-JA');
    const vol = tmp();
    copyFileSync(path.join(import.meta.dirname, 'fixtures', 'a4-formular-ohne-anschriftzone.typ'), path.join(vol, 'a4-formular.typ'));
    expect(words((await render(vol)).bytes).map((w) => w.word)).toContain('ZONE-NEIN');
  });
});
