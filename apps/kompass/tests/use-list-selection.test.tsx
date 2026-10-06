// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { listKeyOf, useListSelection } from '@/lib/use-list-selection';

const a = { id: 'a' };
const b = { id: 'b' };

describe('useListSelection', () => {
  it('toggles ids', () => {
    const items = [a, b];
    const { result } = renderHook(() => useListSelection('k', items));
    act(() => result.current.toggle(['a', 'b'], true));
    expect([...result.current.ids].sort()).toEqual(['a', 'b']);
    act(() => result.current.toggle(['a'], false));
    expect([...result.current.ids]).toEqual(['b']);
  });

  it('keeps what is still there when the same list comes back, clears on another list (Review Focus 2)', () => {
    let props = { key: 'k', items: [a, b] };
    const { result, rerender } = renderHook(() => useListSelection(props.key, props.items));
    act(() => result.current.toggle(['a', 'b'], true));
    props = { key: 'k', items: [b] };
    rerender();
    expect([...result.current.ids]).toEqual(['b']);
    props = { key: 'other', items: [a, b] };
    rerender();
    expect(result.current.ids.size).toBe(0);
  });

  it('builds the list key from the filters, not from the sort', () => {
    expect(listKeyOf(new URLSearchParams('status=reserved&sort=name&dir=desc&text=bo'))).toBe('status=reserved&text=bo');
    expect(listKeyOf(new URLSearchParams('sort=name'))).toBe('');
  });
});
