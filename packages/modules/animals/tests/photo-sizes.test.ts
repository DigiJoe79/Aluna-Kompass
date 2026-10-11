import { storeMediaAsset, unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { photoPixelSizes } from '../src';
import { manager, png, proposalDeps } from './proposal-fixture';

/** Pixelmaße der Fotos für die Maske (Plan B Task 2): „Ausschnitt …“ und die Breite im Hinweis rechnen daraus. */
describe('photoPixelSizes', () => {
  it('liest Breite und Höhe aus media_assets; unbekannte IDs und Medien ohne Maße fehlen', async () => {
    const d = await proposalDeps();
    const m = unwrap(await storeMediaAsset(d, manager, { originalName: 'a.png', bytes: await png(1) }));
    const pdf = unwrap(await storeMediaAsset(d, manager, { originalName: 'a.pdf', bytes: new TextEncoder().encode('%PDF-1.4\n%%EOF') }));
    expect(m.width).toBeGreaterThan(0);
    expect(photoPixelSizes(d, [m.id, pdf.id, 'gibt-es-nicht'])).toEqual({ [m.id]: { width: m.width, height: m.height } });
    expect(photoPixelSizes(d, [])).toEqual({});
  });
});
