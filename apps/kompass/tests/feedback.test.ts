import { describe, expect, it } from 'vitest';
import { isRefusal } from '@/lib/actions';
import { runAction, withUnplacedFieldErrors } from '@/lib/feedback';

describe('runAction', () => {
  it('reicht das Ergebnis der Aktion durch', async () => {
    expect(await runAction(async () => ({ status: 'success' }), 'Netz')).toEqual({ status: 'success' });
  });
  it('behandelt eine weiterleitende Aktion ohne Rückgabe als Erfolg', async () => {
    expect(await runAction(async () => undefined as never, 'Netz')).toEqual({ status: 'success' });
  });
  it('macht aus einer geworfenen Aktion eine Netzmeldung statt eines hängenden Knopfs', async () => {
    const result = await runAction(async () => { throw new TypeError('Failed to fetch'); }, 'Verbindung weg');
    expect(result).toEqual({ status: 'error', kind: 'network', message: 'Verbindung weg', fieldErrors: {} });
  });
});

describe('isRefusal', () => {
  it('ist eine Ablehnung nur ohne Feldfehler und ohne Netz', () => {
    expect(isRefusal({ status: 'error', message: 'x', fieldErrors: {} })).toBe(true);
    expect(isRefusal({ status: 'error', message: 'x', fieldErrors: { name: 'fehlt' } })).toBe(false);
    expect(isRefusal({ status: 'error', message: 'x', fieldErrors: {}, kind: 'network' })).toBe(false);
    expect(isRefusal({ status: 'idle' })).toBe(false);
  });
});

describe('withUnplacedFieldErrors', () => {
  it('zeigt die Ablehnung, sobald ein Feldfehler kein Feld in der Maske hat', () => {
    const state = { status: 'error' as const, message: 'Bitte prüfen', fieldErrors: { name: 'fehlt', sphere: 'fehlt' } };
    expect(isRefusal(withUnplacedFieldErrors(state, ['sphere']))).toBe(true);
    expect(isRefusal(withUnplacedFieldErrors(state, ['sphere', 'name']))).toBe(false);
    expect(withUnplacedFieldErrors({ status: 'idle' }, [])).toEqual({ status: 'idle' });
  });
});
