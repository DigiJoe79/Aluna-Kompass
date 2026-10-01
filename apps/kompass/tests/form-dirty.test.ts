import { describe, expect, it } from 'vitest';
import { changedValues, countChanged, countChangedValues, rebaseSnapshot, snapshotOf } from '@/lib/form-dirty';

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

describe('changedValues', () => {
  it('liefert nur die Schlüssel, deren Wert sich seit dem Laden geändert hat', () => {
    const loaded = { claim: { de: 'A' }, dog: 'chiara', count: 3 };
    expect(changedValues(loaded, { claim: { de: 'A' }, dog: 'chiara', count: 3 })).toEqual({});
    expect(changedValues(loaded, { claim: { de: 'B' }, dog: 'chiara', count: 3 })).toEqual({ claim: { de: 'B' } });
    // Leeren ist eine Änderung: null wird mitgeschickt, damit der Dienst die Zeile löscht.
    expect(changedValues(loaded, { claim: { de: 'A' }, dog: null, count: 3 })).toEqual({ dog: null });
  });
});

describe('snapshotOf mit ausgenommenen Feldern', () => {
  // Ein Feld, das keinen Datensatz ändert – der Haken „Beim Bestätigen veröffentlichen“ wirkt nur beim Bestätigen.
  it('lässt ausgenommene Felder aus dem Stand, sodass ihr Umschalten nie zählt', () => {
    const ignore = new Set(['publishOnConfirm']);
    const before = snapshotOf(fd([['name', 'Bo'], ['publishOnConfirm', 'on']]), ignore);
    expect(countChanged(before, snapshotOf(fd([['name', 'Bo']]), ignore))).toBe(0);
    expect(countChanged(before, snapshotOf(fd([['name', 'Boris']]), ignore))).toBe(1);
  });
});

describe('rebaseSnapshot', () => {
  // Ein neuer Ladestand, während die Maske stehen bleibt – „Status ändern“ setzt das Vermittlungsjahr.
  const loaded = snapshotOf(fd([['family', ''], ['adoptedYear', '2026'], ['name', 'Bo']]));

  it('übernimmt unberührte Felder aus dem neuen Ladestand, sodass sie nicht als Änderung zählen', () => {
    const current = loaded;
    const reloaded = snapshotOf(fd([['family', ''], ['adoptedYear', '2024'], ['name', 'Bo']]));
    const next = rebaseSnapshot(loaded, current, reloaded);
    expect(next.get('adoptedYear')).toBe('2024');
    expect(countChanged(next, reloaded)).toBe(0);
  });

  it('lässt angefasste Felder auf dem alten Stand, damit die Eingabe weiter als Änderung zählt', () => {
    const current = snapshotOf(fd([['family', 'Familie G.'], ['adoptedYear', '2026'], ['name', 'Bo']]));
    const reloaded = snapshotOf(fd([['family', 'Familie G.'], ['adoptedYear', '2024'], ['name', 'Bo']]));
    const next = rebaseSnapshot(loaded, current, reloaded);
    expect(next.get('family')).toBe('');
    expect(countChanged(next, reloaded)).toBe(1);
  });

  it('nimmt Felder auf, die erst mit dem neuen Ladestand dazukommen, und lässt verschwundene fallen', () => {
    const reloaded = snapshotOf(fd([['family', ''], ['adoptedYear', '2024'], ['quote.de', '']]));
    const next = rebaseSnapshot(loaded, loaded, reloaded);
    expect(next.has('quote.de')).toBe(true);
    expect(next.has('name')).toBe(false);
    expect(countChanged(next, reloaded)).toBe(0);
  });
});
