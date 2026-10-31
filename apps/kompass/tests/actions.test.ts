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
    expect(getMsg(conflict('documentIsDraft', 'x'))).toBe('errors.conflict.documentIsDraft');
    expect(getMsg(conflict('weird', 'Detail'))).toBe('errors.conflict.default:{"detail":"Detail"}');
    expect(getMsg(conflict('stillPublished', 'Der Datensatz ist veröffentlicht. Ziehen Sie ihn erst zurück.'))).toBe('errors.conflict.stillPublished');
    expect(getMsg(conflict('seedAssetsMissing', 'Technik: a.png'))).toBe('errors.conflict.seedAssetsMissing:{"detail":"a.png"}');
    expect(getMsg(conflict('humanOnly', 'demo.mcpHumanOnlyAllowed'))).toBe('errors.humanOnly');
    expect(getMsg(conflict('settingManaged', 'finance'))).toBe('errors.settingManaged:{"module":"finance"}');
    // V-10: mit Sprachdatei der Name des Moduls, nicht sein Schlüssel.
    const tNames = Object.assign((key: string, values?: Record<string, unknown>) => (key === 'modules.names.finance' ? 'Finanzen' : values ? `${key}:${JSON.stringify(values)}` : key), { has: (key: string) => key === 'modules.names.finance' });
    const named = toActionState(conflict('settingManaged', 'finance'), tNames);
    expect(named.status === 'error' ? named.message : null).toBe('errors.settingManaged:{"module":"Finanzen"}');
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

  it('shows the sentence of the language file as detail, not the text of the service', () => {
    // `RefusalNotice` zeigt `detail ?? message`: Der Diensttext stand bis 0.5.1 vor dem Satz der Sprachdatei.
    expect(toActionState(conflict('documentIsDraft', 'Dokument 12: Entwurf'), t)).toMatchObject({ code: 'documentIsDraft', detail: 'errors.conflict.documentIsDraft' });
    expect(toActionState(conflict('weird', 'Etwas: Detail'), t)).toMatchObject({ code: 'weird', detail: 'Detail' });
  });

  it('passes conflict code and raw detail through toActionState', () => {
    const withColon = toActionState(conflict('weird', 'Wird verwendet: Tier X'), t);
    expect(withColon).toMatchObject({ status: 'error', code: 'weird', detail: 'Tier X' });
    const withoutColon = toActionState(conflict('cashWouldGoNegative', 'Das Barkonto Kasse waere im Minus. Pruefen Sie Datum und Betrag.'), t);
    expect(withoutColon).toMatchObject({ status: 'error', code: 'cashWouldGoNegative', detail: 'Das Barkonto Kasse waere im Minus. Pruefen Sie Datum und Betrag.' });
    // Bestehende Faelle bleiben grün: code/detail nur bei conflict.
    expect(toActionState(forbidden('finance.read'), t)).toEqual({ status: 'error', message: 'errors.forbidden:{"permission":"finance.read"}', fieldErrors: {} });
    expect(toActionState(ok({ id: 1 }), t, 'saved')).toEqual({ status: 'success', message: 'saved', data: { id: 1 } });
  });

  it('gibt einer veralteten Version Titel und allgemeinen Satz ohne Person und Uhrzeit', () => {
    expect(toActionState(conflict('staleVersion', 'Der Datensatz wurde inzwischen geändert'), t)).toMatchObject({
      status: 'error',
      code: 'staleVersion',
      title: 'common.refused.title',
      detail: 'common.conflict.textPlain',
    });
  });
});
