import { describe, expect, it } from 'vitest';
import { PREFERENCE_BOOTSTRAP } from '@/lib/preference-bootstrap';

/**
 * Das Bootstrap-Skript läuft als Text im `<head>`, bevor React übernimmt. Es
 * hat deshalb keinen Import und keinen Typ — der einzige Weg, es ehrlich zu
 * prüfen, ist, es auszuführen. Die drei Namen, die es von der Seite erwartet,
 * kommen hier als Parameter herein.
 */
function run(store: Record<string, string>, prefersDark = false): Record<string, string> {
  const attributes: Record<string, string> = {};
  const localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
  };
  const document = { documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value; } } };
  const matchMedia = () => ({ matches: prefersDark });
  new Function('localStorage', 'document', 'matchMedia', PREFERENCE_BOOTSTRAP)(localStorage, document, matchMedia);
  return attributes;
}

describe('PREFERENCE_BOOTSTRAP', () => {
  /**
   * `usePreference` schreibt mit `JSON.stringify`, in `localStorage` steht
   * also `"compact"` mitsamt Anführungszeichen. Wer den Wert roh ins Attribut
   * setzt, schreibt `data-density='"compact"'` — und keine einzige CSS-Regel
   * trifft mehr zu. Die Einstellung war dadurch nach jedem Neuladen wirkungslos.
   */
  it('unpacks the stored JSON instead of writing quotes into the attribute', () => {
    const attributes = run({ 'kompass.density': JSON.stringify('compact'), 'kompass.colorScheme': JSON.stringify('dark') });
    expect(attributes['data-density']).toBe('compact');
    expect(attributes['data-color-scheme']).toBe('dark');
  });

  it('falls back to the system preference when no scheme was stored', () => {
    expect(run({}, true)['data-color-scheme']).toBe('dark');
    expect(run({}, false)['data-color-scheme']).toBe('light');
  });

  it('leaves the density attribute off when nothing was stored', () => {
    expect(run({})).not.toHaveProperty('data-density');
  });

  /**
   * Beide Präferenzen lagen bisher in einem gemeinsamen `try`. Ein unlesbarer
   * Wert — aus einer alten Version oder von Hand gesetzt — hätte damit auch
   * die jeweils andere mitgenommen, im schlimmsten Fall den Dunkelmodus.
   */
  it('does not let one unreadable value take the other preference down', () => {
    const attributes = run({ 'kompass.density': '{kaputt', 'kompass.colorScheme': JSON.stringify('dark') });
    expect(attributes['data-color-scheme']).toBe('dark');
    expect(attributes).not.toHaveProperty('data-density');
  });

  it('ignores a stored value that is not one of the three densities', () => {
    expect(run({ 'kompass.density': JSON.stringify('winzig') })).not.toHaveProperty('data-density');
  });
});
