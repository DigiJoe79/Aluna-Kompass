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
    expect(getMsg(conflict('weird', 'Detail'))).toBe('errors.conflict.default:{"detail":"Detail"}');
    expect(getMsg(notFound('user', '1'))).toBe('errors.notFound');
    expect(getMsg(unauthorized('locked'))).toBe('errors.unauthorized');
  });
});
