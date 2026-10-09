import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import { isRefusal } from '@/lib/actions';
import { runAction, toastUndo, withUnplacedFieldErrors } from '@/lib/feedback';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

describe('runAction', () => {
  it('reicht das Ergebnis der Aktion durch', async () => {
    expect(await runAction(async () => ({ status: 'success' }), 'Netz')).toEqual({ status: 'success' });
  });
  it('behandelt eine weiterleitende Aktion ohne Rückgabe als Erfolg', async () => {
    expect(await runAction(async () => undefined as never, 'Netz')).toEqual({ status: 'success' });
  });
  it('eine Weiterleitung, die Next beim direkten Aufruf als Fehler meldet, ist ein Erfolg, kein Netzfehler', async () => {
    // So kam sie im Browser an (Befund 19 in 0.2.9): Next navigiert selbst, der Aufrufer bekommt NEXT_REDIRECT.
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;push;/login?imported=1;307;' });
    expect(await runAction(async () => { throw redirect; }, 'Netz')).toEqual({ status: 'success' });
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

describe('toastUndo', () => {
  it('ein Toast mit „Rückgängig“, 8 s, feste Kennung — ein neuer ersetzt den alten; Rückgängig ruft die Gegenaktion', async () => {
    const undo = vi.fn(async () => ({ status: 'success' }) as const);
    toastUndo('Partner archiviert.', undo, { undo: 'Rückgängig', network: 'Netz' });
    const [message, opts] = vi.mocked(toast).mock.calls[0]!;
    expect(message).toBe('Partner archiviert.');
    expect(opts).toMatchObject({ id: 'record-undo', duration: 8000, action: { label: 'Rückgängig' } });
    await (opts as unknown as { action: { onClick: () => Promise<void> } }).action.onClick();
    expect(undo).toHaveBeenCalledTimes(1);
    toastUndo('Partner archiviert.', undo, { undo: 'Rückgängig', network: 'Netz' });
    expect(vi.mocked(toast).mock.calls[1]![1]).toMatchObject({ id: 'record-undo' });
  });
});
