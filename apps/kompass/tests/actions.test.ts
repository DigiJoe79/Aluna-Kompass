import { conflict, forbidden, invalid, notFound, ok, unauthorized } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { toActionState } from '@/lib/actions';

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

describe('toActionState', () => {
  it('maps success with optional message and data', () => {
    expect(toActionState(ok({ id: 1 }), t, 'saved')).toEqual({ status: 'success', message: 'saved', data: { id: 1 } });
  });
  it('maps forbidden with the permission key', () => {
    expect(toActionState(forbidden('users.manage'), t)).toEqual({ status: 'error', message: 'errors.forbidden:{"permission":"users.manage"}', fieldErrors: {} });
  });
  it('maps validation issues to field errors with translated messages', () => {
    const state = toActionState(invalid([{ path: 'email', message: 'Invalid email' }, { path: 'password', message: 'passwordTooShort' }]), t);
    expect(state).toEqual({
      status: 'error',
      message: 'errors.validation',
      fieldErrors: { email: 'errors.fields.email', password: 'errors.fields.passwordTooShort' },
    });
  });
  it('maps conflicts by code, notFound and unauthorized', () => {
    const getMsg = (res: Parameters<typeof toActionState>[0]) => {
      const state = toActionState(res, t);
      return state.status === 'error' ? state.message : null;
    };
    expect(getMsg(conflict('emailTaken', 'x'))).toBe('errors.conflict.emailTaken');
    expect(getMsg(conflict('insufficientPrivileges', 'Dafür fehlen eigene Rechte: audit.view'))).toBe('errors.conflict.insufficientPrivileges');
    expect(getMsg(conflict('weird', 'Detail'))).toBe('errors.conflict.default:{"detail":"Detail"}');
    expect(getMsg(conflict('stillPublished', 'Der Datensatz ist veröffentlicht. Ziehen Sie ihn erst zurück.'))).toBe('errors.conflict.stillPublished');
    expect(getMsg(conflict('recordHeld', 'Noch gehalten von: Vertrag V-1 (bis 2036-12-31)'))).toBe('errors.conflict.recordHeld:{"detail":"Vertrag V-1 (bis 2036-12-31)"}');
    expect(getMsg(conflict('stillReferenced', 'Es zeigt noch darauf: Dokument X'))).toBe('errors.conflict.stillReferenced:{"detail":"Dokument X"}');
    expect(getMsg(conflict('humanOnly', 'demo.mcpHumanOnlyAllowed'))).toBe('errors.humanOnly');
    expect(getMsg(conflict('settingManaged', 'finance'))).toBe('errors.settingManaged:{"module":"finance"}');
    expect(getMsg(conflict('settingUiOnly', 'host.allowRobots'))).toBe('errors.settingUiOnly');
    expect(getMsg(conflict('moduleRefusesDisable', 'hasFinalRecords'))).toBe('modules.cannotDisable.generic');
    const tWithHas = Object.assign(
      (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
      { has: (key: string) => key === 'modules.cannotDisable.hasFinalRecords' },
    );
    const customState = toActionState(conflict('moduleRefusesDisable', 'hasFinalRecords'), tWithHas);
    expect(customState.status === 'error' ? customState.message : null).toBe('modules.cannotDisable.hasFinalRecords');
    expect(notFound('user', '1')).toBeDefined();
    expect(getMsg(notFound('user', '1'))).toBe('errors.notFound');
    expect(getMsg(unauthorized('locked'))).toBe('errors.unauthorized');
  });

  it('passes conflict code and raw detail through toActionState', () => {
    const withColon = toActionState(conflict('recordHeld', 'Noch gehalten von: Vertrag V-1 (bis 2036-12-31)'), t);
    expect(withColon).toMatchObject({ status: 'error', code: 'recordHeld', detail: 'Vertrag V-1 (bis 2036-12-31)' });
    const withoutColon = toActionState(conflict('cashWouldGoNegative', 'Das Barkonto Kasse waere im Minus. Pruefen Sie Datum und Betrag.'), t);
    expect(withoutColon).toMatchObject({ status: 'error', code: 'cashWouldGoNegative', detail: 'Das Barkonto Kasse waere im Minus. Pruefen Sie Datum und Betrag.' });
    // Bestehende Faelle bleiben grün: code/detail nur bei conflict.
    expect(toActionState(forbidden('finance.read'), t)).toEqual({ status: 'error', message: 'errors.forbidden:{"permission":"finance.read"}', fieldErrors: {} });
    expect(toActionState(ok({ id: 1 }), t, 'saved')).toEqual({ status: 'success', message: 'saved', data: { id: 1 } });
  });
});
