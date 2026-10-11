import { describe, expect, it } from 'vitest';
import { applyCrop, switchPrimaryCrop } from '@/lib/primary-crop';

const A = { x: 0.1, y: 0, w: 0.8, h: 1 };
const B = { x: 0, y: 0.2, w: 1, h: 0.6 };

/**
 * Titelbild wechseln (Spec Ausschnitt in der Prüfung § 2.4, Board 4): eine Regel für Prüfung und Tierformular. Der
 * Ausschnitt des alten Titelbilds fällt weg und wird gemerkt; wird dasselbe Foto wieder Titelbild, kommt er zurück.
 */
describe('switchPrimaryCrop', () => {
  it('removes the crop of the old primary and remembers it', () => {
    const next = switchPrimaryCrop({ crops: { a: A, b: null }, removed: {} }, { key: 'a', stays: true }, 'b');
    expect(next.crops).toEqual({ a: null, b: null });
    expect(next.removed).toEqual({ a: A });
    expect(next.removedFrom).toBe('a');
  });

  it('the new primary keeps its own crop — no automatic cut', () => {
    const next = switchPrimaryCrop({ crops: { a: A, b: B }, removed: {} }, { key: 'a', stays: true }, 'b');
    expect(next.crops.b).toEqual(B);
  });

  it('switching back brings the remembered crop back', () => {
    const away = switchPrimaryCrop({ crops: { a: A, b: B }, removed: {} }, { key: 'a', stays: true }, 'b');
    const back = switchPrimaryCrop(away, { key: 'b', stays: true }, 'a');
    expect(back.crops).toEqual({ a: A, b: null });
    expect(back.removed).toEqual({ b: B });
    expect(back.removedFrom).toBe('b');
  });

  it('an old primary without crop: nothing removed, nothing to announce', () => {
    const next = switchPrimaryCrop({ crops: { a: null, b: B }, removed: {} }, { key: 'a', stays: true }, 'b');
    expect(next.crops).toEqual({ a: null, b: B });
    expect(next.removed).toEqual({});
    expect(next.removedFrom).toBeNull();
  });

  it('an old primary that leaves the animal (left out, deselected) keeps its crop for a restore', () => {
    const next = switchPrimaryCrop({ crops: { a: A, b: null }, removed: {} }, { key: 'a', stays: false }, 'b');
    expect(next.crops).toEqual({ a: A, b: null });
    expect(next.removedFrom).toBeNull();
  });

  it('the same photo or no photo: unchanged', () => {
    const state = { crops: { a: A }, removed: {} };
    expect(switchPrimaryCrop(state, { key: 'a', stays: true }, 'a')).toEqual({ ...state, removedFrom: null });
    expect(switchPrimaryCrop(state, null, 'a')).toEqual({ ...state, removedFrom: null });
    expect(switchPrimaryCrop(state, { key: 'a', stays: true }, null).crops).toEqual({ a: null });
  });
});

describe('applyCrop', () => {
  it('sets the crop and forgets what was remembered for that photo', () => {
    const next = applyCrop({ crops: { a: null, b: null }, removed: { a: A, b: B } }, 'a', null);
    expect(next.crops).toEqual({ a: null, b: null });
    expect(next.removed).toEqual({ b: B });
  });
});
