import { describe, expect, it } from 'vitest';
import { conflictRemedies, stashInputs, takeStash } from '@/lib/conflict-remedies';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function throwingStorage(): Storage {
  const fail = () => { throw new Error('gesperrt'); };
  return { get length() { return 0; }, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe('Konflikt-Auswege', () => {
  it('legt Eingaben je Pfad ab und gibt sie genau einmal zurück', () => {
    const storage = memoryStorage();
    stashInputs('/projects/1', [{ name: 'name', label: 'Name', value: 'Neu' }], storage);
    expect(takeStash('/projects/2', storage)).toBeNull();
    expect(takeStash('/projects/1', storage)).toEqual([{ name: 'name', label: 'Name', value: 'Neu' }]);
    expect(takeStash('/projects/1', storage)).toBeNull();
  });
  it('übersteht kaputten oder fehlenden Speicher (privates Fenster)', () => {
    expect(() => stashInputs('/x', [], throwingStorage())).not.toThrow();
    expect(takeStash('/x', throwingStorage())).toBeNull();
  });
  it('nennt zwei Auswege, Vergleich zuerst', () => {
    const remedies = conflictRemedies({ compare: () => {}, reload: () => {} }, (k) => k);
    expect(remedies.map((r) => r.label)).toEqual(['conflict.compare', 'conflict.reload']);
  });
});
