import { describe, expect, it } from 'vitest';
import { derivedAssetId } from '../src/media/derived-id';
import { AI_LABELING_ENABLED_KEY } from '../src/media/ai-labeling';
import { setMediaAiKind } from '../src/media/ai-kind';
import { mediaPixelSizes } from '../src/media/pixel-sizes';
import { writeSettingInternal } from '../src/settings/service';
import { storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');

/** Pixelmaße für Bildfelder mit Ausschnitt (Spec Ausschnitt für alle Bilder § 4): ohne sie kein „Ausschnitt …“. */
describe('mediaPixelSizes', () => {
  it('liest Breite und Höhe der Rasterbilder, auch zu abgeleiteten IDs; SVG und Unbekanntes fehlen', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const png = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    const svg = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'b.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    const derived = derivedAssetId(png.id, { x: 0, y: 0, w: 1, h: 1 });
    expect(mediaPixelSizes(deps, [derived, svg.id, 'gibt-es-nicht'])).toEqual({ [png.id]: { width: 1, height: 1 } });
    expect(mediaPixelSizes(deps, [])).toEqual({});
  });

  it('sammelt die Bilder aus beliebig verschachtelten Werten (Template-Werte, Listen)', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const png = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    const value = { title: { de: 'x' }, gallery: [{ image: derivedAssetId(png.id, { x: 0, y: 0, w: 0.5, h: 1 }) }], n: 3 };
    expect(mediaPixelSizes(deps, value)).toEqual({ [png.id]: { width: 1, height: 1 } });
    // Nur Zeichenketten in Form einer ID gehen in die Abfrage, nicht jeder Absatz eines Textfelds.
    const many = { texts: Array.from({ length: 40_000 }, (_, i) => `Absatz ${i}`), image: png.id };
    expect(mediaPixelSizes(deps, many)).toEqual({ [png.id]: { width: 1, height: 1 } });
  });

  it('trägt die KI-Art eines gekennzeichneten Bilds mit, solange die Kennzeichnung an ist (Spec KI-Transparenz)', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const png = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    writeSettingInternal(deps.db, deps, ctx, AI_LABELING_ENABLED_KEY, true);
    unwrap(await setMediaAiKind(deps, ctx, { id: png.id, aiKind: 'edited' }));
    expect(mediaPixelSizes(deps, [derivedAssetId(png.id, { x: 0, y: 0, w: 1, h: 1 })])).toEqual({ [png.id]: { width: 1, height: 1, aiKind: 'edited' } });
    writeSettingInternal(deps.db, deps, ctx, AI_LABELING_ENABLED_KEY, false);
    expect(mediaPixelSizes(deps, [png.id])).toEqual({ [png.id]: { width: 1, height: 1 } });
  });
});
