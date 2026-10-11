import { roundCrop as moduleRoundCrop } from '@kompass/module-animals';
import { IMAGE_WIDTHS, MAIN_IMAGE_MAX_WIDTH } from '@kompass/module-site';
import { describe, expect, it } from 'vitest';
import {
  aspectLabel,
  aspectOf,
  cropPixelWidth,
  fitToFormat,
  formatOf,
  formatRow,
  fullFormat,
  matchFormat,
  orientationOf,
  ratioValue,
  trimOf,
  initialCrop,
  MAX_ZOOM,
  moveBy,
  pinch,
  positionOf,
  resizeAroundCenter,
  resizeFromCorner,
  roundCrop,
  setZoom,
  zoomOf,
  type Crop,
  type CropGeometry,
} from '@/lib/crop-geometry';

const near = (actual: Crop, expected: Partial<Crop>) => {
  for (const [k, v] of Object.entries(expected)) expect(actual[k as keyof Crop], k).toBeCloseTo(v, 6);
};
/** Seitenverhältnis in Pixeln — muss nach jeder Bewegung exakt das Format sein. */
const pxAspect = (c: { w: number; h: number }, g: CropGeometry) => (c.w * g.width) / (c.h * g.height);

const quer: CropGeometry = { width: 4000, height: 3000, aspect: 4 / 5 };
const hoch: CropGeometry = { width: 3000, height: 4000, aspect: 4 / 5 };
const quadrat: CropGeometry = { width: 2000, height: 2000, aspect: 4 / 5 };

describe('initialCrop — so, wie object-fit: cover mit object-position heute zeigt', () => {
  it('Querformat 4000×3000 in 4:5: volle Höhe, am Blickpunkt', () => {
    near(initialCrop(quer, { focusX: 50, focusY: 50 }), { x: 0.2, y: 0, w: 0.6, h: 1 });
    near(initialCrop(quer, { focusX: 0, focusY: 50 }), { x: 0, y: 0, w: 0.6, h: 1 });
    near(initialCrop(quer, { focusX: 100, focusY: 0 }), { x: 0.4, y: 0, w: 0.6, h: 1 });
  });
  it('Hochformat 3000×4000 in 4:5: volle Breite, Blickpunkt oben', () => {
    near(initialCrop(hoch, { focusX: 50, focusY: 25 }), { x: 0, y: 0.015625, w: 1, h: 0.9375 });
    near(initialCrop(hoch, { focusX: 50, focusY: 100 }), { x: 0, y: 0.0625, w: 1, h: 0.9375 });
  });
  it('quadratisch 2000×2000 in 4:5', () => {
    near(initialCrop(quadrat, { focusX: 50, focusY: 50 }), { x: 0.1, y: 0, w: 0.8, h: 1 });
  });
  it('hält das Format exakt und gilt als Zoom 1', () => {
    const c = initialCrop(hoch, { focusX: 30, focusY: 70 });
    expect(pxAspect(c, hoch)).toBeCloseTo(0.8, 10);
    expect(zoomOf(c, hoch)).toBeCloseTo(1, 10);
  });
});

describe('Bewegen und Größe', () => {
  const start = initialCrop(quer, { focusX: 50, focusY: 50 });

  it('verschiebt und bleibt im Bild', () => {
    near(moveBy(start, quer, 0.1, 0), { x: 0.3, y: 0 });
    near(moveBy(start, quer, 1, 1), { x: 0.4, y: 0 });
    near(moveBy(start, quer, -1, -1), { x: 0, y: 0 });
  });

  it('Größe um die Mitte zwischen 1 und 1,9', () => {
    const z = resizeAroundCenter(start, quer, 0.5);
    expect(zoomOf(z, quer)).toBeCloseTo(1.5, 10);
    expect(z.x + z.w / 2).toBeCloseTo(0.5, 10);
    expect(z.y + z.h / 2).toBeCloseTo(0.5, 10);
    expect(zoomOf(resizeAroundCenter(z, quer, 5), quer)).toBeCloseTo(MAX_ZOOM, 10);
    expect(zoomOf(resizeAroundCenter(z, quer, -5), quer)).toBeCloseTo(1, 10);
    expect(pxAspect(resizeAroundCenter(z, quer, 0.13), quer)).toBeCloseTo(0.8, 10);
  });

  it('setZoom an der Grenze 1,9: Breite 0,6/1,9', () => {
    const z = setZoom(start, quer, 1.9);
    near(z, { w: 0.6 / 1.9, h: 1 / 1.9 });
    expect(zoomOf(setZoom(start, quer, 3), quer)).toBeCloseTo(1.9, 10);
    expect(zoomOf(setZoom(start, quer, 1.9, 1.5), quer)).toBeCloseTo(1.5, 10);
  });

  it('Größer am Rand rückt ins Bild', () => {
    const corner = moveBy(setZoom(start, quer, 1.9), quer, 1, 1);
    const big = setZoom(corner, quer, 1);
    near(big, { x: 0.4, y: 0, w: 0.6, h: 1 });
  });

  it('Ecke ändert die Größe um die Gegenecke', () => {
    const se = resizeFromCorner(start, quer, 'se', { x: 0.6, y: 0.7 });
    near(se, { x: 0.2, y: 0, w: 0.42, h: 0.7 });
    expect(pxAspect(se, quer)).toBeCloseTo(0.8, 10);
    // Über die Gegenecke hinaus: kleinste Größe, die Gegenecke bleibt.
    const tiny = resizeFromCorner(start, quer, 'se', { x: 0, y: 0 });
    expect(zoomOf(tiny, quer)).toBeCloseTo(1.9, 10);
    near(tiny, { x: 0.2, y: 0 });
    // Weit nach außen: höchstens so groß, wie von der Gegenecke aus Platz ist.
    const nw = resizeFromCorner(setZoom(moveBy(start, quer, 0, 0), quer, 1.5), quer, 'nw', { x: -1, y: -1 });
    expect(nw.x).toBeGreaterThanOrEqual(0);
    expect(nw.y).toBeGreaterThanOrEqual(-1e-12);
    expect(zoomOf(nw, quer)).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('zwei Finger: Spreizen vergrößert (Rechteck kleiner) um ihren Mittelpunkt, Grenzen halten', () => {
    const p = pinch(start, quer, { x: 0.5, y: 0.5 }, 1.2);
    near(p, { x: 0.25, y: 0.5 - 0.5 / 1.2, w: 0.5, h: 1 / 1.2 });
    expect(zoomOf(pinch(start, quer, { x: 0.5, y: 0.5 }, 10), quer)).toBeCloseTo(1.9, 10);
    near(pinch(start, quer, { x: 0.5, y: 0.5 }, 0.1), { w: 0.6, h: 1 });
  });

  it('ganzes Format: größtmöglich um den Mittelpunkt, ins Bild gerückt', () => {
    const small = moveBy(setZoom(start, quer, 1.9), quer, -1, 0);
    near(fullFormat(small, quer), { x: 0, y: 0, w: 0.6, h: 1 });
  });

  it('Pixelbreite aus crop.w × Breite', () => {
    expect(cropPixelWidth(start, 4000)).toBe(2400);
    expect(cropPixelWidth(setZoom(start, quer, 1.9), 4000)).toBe(1263);
  });
});

describe('Formatwechsel', () => {
  it('4:5 → 4:3: größtes Rechteck im neuen Format mittig im alten', () => {
    const old = initialCrop(quer, { focusX: 50, focusY: 50 });
    const next = fitToFormat(old, { ...quer, aspect: 4 / 3 });
    near(next, { x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
    expect(pxAspect(next, quer)).toBeCloseTo(4 / 3, 10);
  });
  it('erkennt das Format mit Toleranz für die Rundung', () => {
    const c = roundCrop(setZoom(initialCrop(quer, { focusX: 37, focusY: 50 }), quer, 1.77));
    expect(formatOf(c, quer)).toBeCloseTo(0.8, 3);
  });
  it('benennt Formate', () => {
    expect(aspectOf('4:5')).toBeCloseTo(0.8, 10);
    expect(aspectLabel(0.8)).toBe('4:5');
    expect(aspectLabel(4 / 3)).toBe('4:3');
    expect(aspectLabel(16 / 9)).toBe('16:9');
    expect(aspectLabel(formatOf({ x: 0, y: 0, w: 0.6, h: 1 }, quer))).toBe('4:5');
  });
});

describe('Rundung und Lage', () => {
  it('rundet wie roundCrop des Moduls', () => {
    const c = { x: 0.123456, y: 0.98765, w: 0.333333, h: 0.0000449 };
    expect(roundCrop(c)).toEqual(moduleRoundCrop(c));
  });
  it('Lage in Worten aus dem Mittelpunkt, Drittel', () => {
    expect(positionOf({ x: 0, y: 0.3, w: 0.3, h: 0.4 })).toEqual({ v: 'middle', h: 'left' });
    expect(positionOf({ x: 0.7, y: 0, w: 0.3, h: 0.3 })).toEqual({ v: 'top', h: 'right' });
    expect(positionOf({ x: 0.35, y: 0.7, w: 0.3, h: 0.3 })).toEqual({ v: 'bottom', h: 'center' });
  });
});

describe('Schwelle aus der Pipeline', () => {
  it('ist die größte Hauptbild-Breite aus IMAGE_WIDTHS, keine eigene Zahl der Oberfläche', () => {
    expect(IMAGE_WIDTHS).toContain(MAIN_IMAGE_MAX_WIDTH);
    expect(MAIN_IMAGE_MAX_WIDTH).toBe(960);
  });
});

describe('Formatwahl für alle Bilder (Handover alle Bilder 1, Datenmodell)', () => {
  it('„Original“ ist das Format des Bilds; Hochformate sind gedrehte Querformate', () => {
    expect(ratioValue('original', 4000, 3000)).toBeCloseTo(4 / 3, 9);
    expect(ratioValue('3:4', 4000, 3000)).toBeCloseTo(0.75, 9);
    expect(ratioValue('9:16', 1, 1)).toBeCloseTo(9 / 16, 9);
  });

  it('volle Reihe: Original, 1:1, 4:3, 3:2, 16:9; hoch 3:4, 2:3, 9:16', () => {
    expect(formatRow('landscape')).toEqual(['original', '1:1', '4:3', '3:2', '16:9']);
    expect(formatRow('portrait')).toEqual(['original', '1:1', '3:4', '2:3', '9:16']);
    expect(orientationOf('3:4')).toBe('portrait');
    expect(orientationOf('4:5')).toBe('portrait');
    expect(orientationOf('16:9')).toBe('landscape');
    expect(orientationOf('1:1')).toBe('landscape');
  });

  it('ohne Ausschnitt: das erste erlaubte Format, bei voller Reihe „Original“', () => {
    expect(matchFormat(null, 4000, 3000, ['16:10', '16:9'])).toEqual({ ratio: '16:10', exact: true });
    expect(matchFormat(null, 4000, 3000, [])).toEqual({ ratio: 'original', exact: true });
  });

  it('mit Ausschnitt: das passende Format, „Original“ vor einem gleichen Seitenverhältnis', () => {
    // 4000 × 3000 ganz: Original (auch 4:3).
    expect(matchFormat({ x: 0, y: 0, w: 1, h: 1 }, 4000, 3000, [])).toEqual({ ratio: 'original', exact: true });
    // 2400 × 3000 = 4:5 → in der vollen Reihe gibt es kein 4:5: nächstliegend 3:4, nicht exakt.
    expect(matchFormat({ x: 0.2, y: 0, w: 0.6, h: 1 }, 4000, 3000, [])).toEqual({ ratio: '3:4', exact: false });
    // 3000 × 3000 = 1:1.
    expect(matchFormat({ x: 0, y: 0, w: 0.75, h: 1 }, 4000, 3000, [])).toEqual({ ratio: '1:1', exact: true });
    // Mehrere erlaubte: nur daraus.
    expect(matchFormat({ x: 0, y: 0, w: 1, h: 1 }, 4000, 3000, ['16:10', '16:9'])).toEqual({ ratio: '16:10', exact: false });
    expect(matchFormat({ x: 0, y: 0.0625, w: 1, h: 0.75 }, 4000, 3000, ['16:9', '16:10'])).toEqual({ ratio: '16:9', exact: true });
    // Fest 4:5.
    expect(matchFormat({ x: 0.2, y: 0, w: 0.6, h: 1 }, 4000, 3000, ['4:5'])).toEqual({ ratio: '4:5', exact: true });
  });

  it('Vorschau: wo eine Stelle nachschneidet', () => {
    expect(trimOf(16 / 9, 4 / 3)).toBe('sides');
    expect(trimOf(4 / 5, 4 / 3)).toBe('topBottom');
    expect(trimOf(4 / 3, 4 / 3 + 0.001)).toBeNull();
  });

  it('Formatwechsel im Dialog: größtmöglich im neuen Format um den alten Mittelpunkt', () => {
    const g43: CropGeometry = { width: 4000, height: 3000, aspect: 4 / 3 };
    const c = fullFormat({ x: 0.5, y: 0.2, w: 0.3, h: 0.5 }, g43);
    near(c, { w: 1, h: 1, x: 0, y: 0 });
  });
});
