import { describe, expect, it } from 'vitest';
import { staleVersion, versionOf } from '../src/concurrency';

/**
 * Ein Speichern, dessen Ladestand veraltet ist, wird abgewiesen statt still zu
 * überschreiben (Backlog 20): Am 13.09. leerte eine offene Maske sechs
 * englische Texte, die ein Agent zwei Minuten vorher über MCP geschrieben hatte.
 */
describe('staleVersion', () => {
  it('lässt durch, wer den aktuellen Stand kennt', () => {
    expect(staleVersion('2026-09-13T18:01:00.000Z', '2026-09-13T18:01:00.000Z')).toBeNull();
  });

  it('lässt durch, wer keinen Stand nennt — MCP und ältere Aufrufer', () => {
    expect(staleVersion(undefined, '2026-09-13T18:01:00.000Z')).toBeNull();
  });

  it('weist ab, wer auf einem älteren Stand speichert', () => {
    const failure = staleVersion('2026-09-13T17:55:00.000Z', '2026-09-13T18:01:00.000Z');
    expect(failure).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
  });
});

describe('versionOf', () => {
  it('ist für denselben Inhalt gleich, unabhängig von der Reihenfolge der Schlüssel', () => {
    expect(versionOf({ a: 1, b: { de: 'x', en: 'y' } })).toBe(versionOf({ b: { en: 'y', de: 'x' }, a: 1 }));
  });

  it('ändert sich mit dem Inhalt', () => {
    expect(versionOf({ a: { de: 'x', en: '' } })).not.toBe(versionOf({ a: { de: 'x', en: 'y' } }));
  });
});
