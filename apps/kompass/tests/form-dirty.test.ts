import { describe, expect, it } from 'vitest';
import { countChanged, countChangedValues, snapshotOf } from '@/lib/form-dirty';

/**
 * Die Formulare der Anwendung sind unkontrolliert: Die Felder tragen
 * `defaultValue`, und abgeschickt wird über eine Server-Action. Den Zähler der
 * Speicherleiste aus React-Zustand zu speisen hiesse, jedes Feld umzubauen.
 *
 * Stattdessen wird der Stand beim Laden festgehalten und bei jeder Eingabe
 * dagegen gehalten — dieselbe Quelle, aus der auch das Abschicken liest.
 */
const fd = (entries: [string, string][]) => {
  const form = new FormData();
  for (const [k, v] of entries) form.append(k, v);
  return form;
};

describe('countChanged', () => {
  it('zählt nichts, solange nichts angefasst wurde', () => {
    const before = snapshotOf(fd([['name', 'Bärbel'], ['slug', 'baerbel']]));

    expect(countChanged(before, snapshotOf(fd([['name', 'Bärbel'], ['slug', 'baerbel']])))).toBe(0);
  });

  it('zählt jedes geänderte Feld einmal', () => {
    const before = snapshotOf(fd([['name', 'Bärbel'], ['slug', 'baerbel']]));

    const after = snapshotOf(fd([['name', 'Bärbel II'], ['slug', 'baerbel-2']]));

    expect(countChanged(before, after)).toBe(2);
  });

  it('merkt, wenn ein Wert dazukommt oder verschwindet', () => {
    // Eine abgewählte Checkbox schickt ihren Namen gar nicht mit.
    const before = snapshotOf(fd([['isEmergency', 'on']]));

    expect(countChanged(before, snapshotOf(fd([])))).toBe(1);
    expect(countChanged(snapshotOf(fd([])), before)).toBe(1);
  });

  it('nimmt mehrfach belegte Namen als ein Feld', () => {
    // Sprachfelder schicken denselben Namen je Sprache.
    const before = snapshotOf(fd([['traits', 'ruhig'], ['traits', 'verspielt']]));

    const after = snapshotOf(fd([['traits', 'ruhig'], ['traits', 'wachsam']]));

    expect(countChanged(before, after)).toBe(1);
  });
});

describe('countChangedValues', () => {
  it('zählt je Schlüssel, nicht je Zeichen', () => {
    const before = { title: { de: 'Sommerfest' }, slug: 'sommerfest', draft: true };

    const after = { title: { de: 'Sommerfest 2026' }, slug: 'sommerfest', draft: true };

    expect(countChangedValues(before, after)).toBe(1);
  });

  it('merkt einen entfernten und einen neuen Schlüssel', () => {
    expect(countChangedValues({ a: 1 }, { b: 2 })).toBe(2);
  });
});
