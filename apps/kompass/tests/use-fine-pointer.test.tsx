// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssetDrag } from '@/components/media/use-asset-drag';
import { useFinePointer } from '@/lib/use-fine-pointer';

/*
 * Am Telefon wird nicht gezogen (Spec Ordnerbaum § 5.6, Befund 0.2.4/11):
 * iOS startet das native Ziehen trotzdem, und der Baum liegt dann zu im
 * Sheet — der Zug verspricht etwas, das nicht geht. Ziehbar ist nur, was
 * mit feinem Zeiger (Maus, Trackpad) bedient wird.
 */
function pointer(fine: boolean | null) {
  if (fine === null) {
    vi.stubGlobal('matchMedia', undefined);
    return;
  }
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: fine)' ? fine : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('useFinePointer', () => {
  it('is true with a mouse and false on a touch screen', () => {
    pointer(true);
    expect(renderHook(() => useFinePointer()).result.current).toBe(true);
    pointer(false);
    expect(renderHook(() => useFinePointer()).result.current).toBe(false);
  });

  it('assumes a mouse where the browser cannot tell', () => {
    pointer(null);
    expect(renderHook(() => useFinePointer()).result.current).toBe(true);
  });
});

describe('useAssetDrag', () => {
  const asset = { id: 'a1', filename: 'rex.jpg', folder: null };

  it('makes a file draggable with a mouse', () => {
    pointer(true);
    expect(renderHook(() => useAssetDrag()).result.current.dragProps(asset)).toMatchObject({ draggable: true });
  });

  it('leaves it alone on a touch screen', () => {
    pointer(false);
    expect(renderHook(() => useAssetDrag()).result.current.dragProps(asset)).toEqual({});
  });
});
