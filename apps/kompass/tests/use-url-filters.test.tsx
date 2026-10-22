// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUrlFilters } from '@/lib/use-url-filters';

type Filters = { text: string; role: string };

/** Die Adresse als Prop: `rerender` spielt nach, was der Router nach `replace`/Zurück liefert. */
function setup(initial: Filters) {
  return renderHook(({ url }: { url: Filters }) => useUrlFilters(url), { initialProps: { url: initial } });
}

describe('useUrlFilters', () => {
  it('startet mit den Filtern aus der Adresse', () => {
    const { result } = setup({ text: 'Luna', role: 'interested' });
    expect(result.current[0]).toEqual({ text: 'Luna', role: 'interested' });
  });

  it('die nachlaufende Adresse frisst beim Tippen keine Buchstaben', () => {
    const { result, rerender } = setup({ text: '', role: '' });
    act(() => result.current[1]({ text: 'L', role: '' }));
    act(() => result.current[1]({ text: 'Lu', role: '' }));
    act(() => result.current[1]({ text: 'Lun', role: '' }));
    expect(result.current[0].text).toBe('Lun');
    // Die Adresse holt die gesendeten Stände nacheinander ein — keiner spielt zurück.
    rerender({ url: { text: 'L', role: '' } });
    expect(result.current[0].text).toBe('Lun');
    rerender({ url: { text: 'Lu', role: '' } });
    expect(result.current[0].text).toBe('Lun');
    rerender({ url: { text: 'Lun', role: '' } });
    expect(result.current[0].text).toBe('Lun');
  });

  it('Leerraum am Rand zählt nicht als Wechsel der Adresse', () => {
    const { result, rerender } = setup({ text: '', role: '' });
    act(() => result.current[1]({ text: 'Lu ', role: '' }));
    rerender({ url: { text: 'Lu', role: '' } });
    expect(result.current[0].text).toBe('Lu ');
  });

  it('folgt einer Adresse, die von außen wechselt (Seitenleiste nimmt den Filter zurück)', () => {
    const { result, rerender } = setup({ text: '', role: '' });
    act(() => result.current[1]({ text: '', role: 'interested' }));
    rerender({ url: { text: '', role: 'interested' } });
    expect(result.current[0]).toEqual({ text: '', role: 'interested' });
    rerender({ url: { text: '', role: '' } });
    expect(result.current[0]).toEqual({ text: '', role: '' });
  });

  it('Zurück und Vor: auch ein früher gesendeter Stand kommt von außen wieder an', () => {
    const { result, rerender } = setup({ text: '', role: '' });
    act(() => result.current[1]({ text: 'Lu', role: '' }));
    rerender({ url: { text: 'Lu', role: '' } });
    rerender({ url: { text: '', role: '' } }); // Zurück
    expect(result.current[0].text).toBe('');
    rerender({ url: { text: 'Lu', role: '' } }); // Vor
    expect(result.current[0].text).toBe('Lu');
  });

  it('ein Wechsel von außen mitten im Tippen gewinnt', () => {
    const { result, rerender } = setup({ text: '', role: '' });
    act(() => result.current[1]({ text: 'L', role: '' }));
    act(() => result.current[1]({ text: 'Lu', role: '' }));
    rerender({ url: { text: '', role: 'member' } }); // Klick in der Seitenleiste, bevor die Adresse nachkam
    expect(result.current[0]).toEqual({ text: '', role: 'member' });
  });
});
