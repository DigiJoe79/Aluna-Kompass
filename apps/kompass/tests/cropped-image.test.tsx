// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CroppedImage, ratioCss } from '@/components/media/cropped-image';

afterEach(cleanup);

const num = (v: string) => parseFloat(v);
const loaded = (img: HTMLImageElement, w: number, h: number) => {
  Object.defineProperty(img, 'naturalWidth', { value: w });
  Object.defineProperty(img, 'naturalHeight', { value: h });
  fireEvent.load(img);
};

/** Rechnung, keine Pixel: Lage und Größe des Bilds in Prozent des Rahmens (Pixeltests für Einzelstellen gibt es nicht). */
describe('CroppedImage', () => {
  it('füllt den Rahmen der Stelle genau mit dem Ausschnitt', () => {
    render(<CroppedImage src="/x" crop={{ x: 0.2, y: 0, w: 0.6, h: 1 }} ratio="4:5" />);
    const box = screen.getByTestId('cropped-image');
    expect(box.style.aspectRatio).toBe('4 / 5');
    const img = box.querySelector('img')!;
    expect(num(img.style.width)).toBeCloseTo(166.667, 2);
    expect(num(img.style.height)).toBeCloseTo(100, 6);
    expect(num(img.style.left)).toBeCloseTo(-33.333, 2);
    expect(num(img.style.top)).toBeCloseTo(0, 6);
  });

  it('schneidet einen Ausschnitt in anderem Format nach wie object-fit: cover, mittig', () => {
    render(<CroppedImage src="/x" crop={{ x: 0.2, y: 0, w: 0.6, h: 1 }} ratio="4:3" />);
    const img = screen.getByTestId('cropped-image').querySelector('img')!;
    loaded(img, 4000, 3000);
    // 4:5-Ausschnitt in 4:3-Rahmen: volle Breite, Höhe 5/3 des Rahmens, mittig.
    expect(num(img.style.width)).toBeCloseTo(166.667, 2);
    expect(num(img.style.height)).toBeCloseTo(166.667, 2);
    expect(num(img.style.left)).toBeCloseTo(-33.333, 2);
    expect(num(img.style.top)).toBeCloseTo(-33.333, 2);
  });

  it('„Original“ (wie gewählt): der Rahmen hat das Format des Ausschnitts', () => {
    render(<CroppedImage src="/x" crop={{ x: 0.2, y: 0, w: 0.6, h: 1 }} ratio="original" />);
    const box = screen.getByTestId('cropped-image');
    loaded(box.querySelector('img')!, 4000, 3000);
    expect(box.style.aspectRatio).toBe('2400 / 3000');
    expect(num(box.querySelector('img')!.style.width)).toBeCloseTo(166.667, 2);
  });

  it('Rahmen als CSS', () => {
    expect(ratioCss('16:9')).toBe('16 / 9');
    expect(ratioCss('original')).toBeUndefined();
  });
});
