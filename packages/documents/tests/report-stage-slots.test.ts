import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';

/**
 * Der Slot-Vertrag der Berichtsbasen (Spec Rechenschaft 0.4.0 § A, Basis und PDF): `stage`/`stageText` in
 * beiden schlanken Basen (seit E2 auch im Hochformat), `footerNote` ebenso. Die Prüffassung steht nur in der
 * Kopfzeile (Designer Runde 6).
 */
const bases = resolveBases(resolveAssetDirs({}));
const renderer = createTypstRenderer();
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/** `raw`: in Inhaltsreihenfolge — ein gedrehter Stempel steht dann als ein Wort da. */
const pdfText = (pdf: Uint8Array, raw = false): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-pdftext-'));
  try {
    writeFileSync(path.join(dir, 'x.pdf'), pdf);
    const out = spawnSync('pdftotext', [...(raw ? ['-raw'] : []), path.join(dir, 'x.pdf'), '-'], { encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`pdftotext: ${out.stderr}`);
    return out.stdout.replace(/\s+/g, ' ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Breite und Höhe der ersten Seite in Punkt, aus `pdfinfo`. */
const pageSize = (pdf: Uint8Array): { width: number; height: number } => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-pdfinfo-'));
  try {
    writeFileSync(path.join(dir, 'x.pdf'), pdf);
    const out = spawnSync('pdfinfo', [path.join(dir, 'x.pdf')], { encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`pdfinfo: ${out.stderr}`);
    const match = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(out.stdout);
    if (!match) throw new Error(`pdfinfo ohne Seitengröße: ${out.stdout}`);
    return { width: Number(match[1]), height: Number(match[2]) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const payload = (slots: Record<string, unknown> = {}) => ({
  brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.city': 'Musterstadt' },
  number: 'FBR-2026-001',
  issuedDate: '24.10.2026',
  slots: { kind: 'report', title: 'Einnahmen und Ausgaben', ...slots },
});

const render = (baseId: string, slots: Record<string, unknown> = {}) => renderer.renderDocument({ baseId, bases, bodyTypst: 'Ein Absatz.', payload: payload(slots) });

describe('report stage slots', () => {
  it('draws the landscape base on a landscape page', async () => {
    const size = pageSize(await render('a4-quer-plain-slim'));
    expect(size.width).toBeGreaterThan(size.height);
  });

  it('changes the pdf for each stage text', async () => {
    const plain = await render('a4-quer-plain-slim');
    const variants = [
      await render('a4-quer-plain-slim', { stage: 'preliminary', stageText: 'VORLÄUFIG' }),
      await render('a4-quer-plain-slim', { stage: 'review', stageText: 'Zur Prüfung – noch nicht festgeschrieben' }),
      await render('a4-quer-plain-slim', { stage: 'final' }),
      await render('a4-quer-plain-slim', { stage: 'final', stageText: 'Ohne schriftlichen Prüfbericht festgeschrieben' }),
    ];
    for (let i = 0; i < variants.length; i++) for (let j = i + 1; j < variants.length; j++) expect(same(variants[i]!, variants[j]!), `${i}/${j}`).toBe(false);
    expect(same(variants[2]!, plain)).toBe(true);
    expect(pdfText(variants[1]!)).toContain('noch nicht festgeschrieben'.toUpperCase());
  });

  it('marks the stage on the portrait base too (Abnahme B1: a preliminary report in portrait was unmarked)', async () => {
    const plain = await render('a4-plain-slim');
    const preliminary = await render('a4-plain-slim', { stage: 'preliminary', stageText: 'VORLÄUFIG' });
    const review = await render('a4-plain-slim', { stage: 'review', stageText: 'Zur Prüfung – noch nicht festgeschrieben' });
    const finalNote = await render('a4-plain-slim', { stage: 'final', stageText: 'Ohne schriftlichen Prüfbericht festgeschrieben' });
    expect(pdfText(preliminary, true)).toContain('VORLÄUFIG');
    expect(pdfText(review)).toContain('noch nicht festgeschrieben'.toUpperCase());
    expect(pdfText(finalNote)).toContain('Ohne schriftlichen Prüfbericht'.toUpperCase());
    expect(same(await render('a4-plain-slim', { stage: 'final' }), plain)).toBe(true);
  });

  it('names the review stage once per page, in the header — not again under the title (Designer Runde 6, 260)', async () => {
    for (const id of ['a4-plain-slim', 'a4-quer-plain-slim']) {
      const text = pdfText(await render(id, { stage: 'review', stageText: 'Zur Prüfung – noch nicht festgeschrieben' }));
      expect(text.split('NOCH NICHT FESTGESCHRIEBEN').length - 1, id).toBe(1);
    }
  });

  it('prints the footer note in both slim bases', async () => {
    const note = 'Erzeugt 24.10.2026, 09:41 · a1b2c3d4';
    for (const id of ['a4-plain-slim', 'a4-quer-plain-slim']) {
      const withNote = await render(id, { footerNote: note });
      expect(same(withNote, await render(id)), id).toBe(false);
      expect(pdfText(withNote), id).toContain('a1b2c3d4');
    }
  });
});
