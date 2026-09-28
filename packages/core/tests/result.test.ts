import { describe, expect, it } from 'vitest';
import { combineConflicts, conflict, forbidden, invalid, localizedConflict, notFound, ok, unauthorized, unwrap } from '../src/result';

describe('result', () => {
  it('ok wraps a value', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });

  it('forbidden carries the permission key', () => {
    expect(forbidden('users.manage')).toEqual({
      ok: false,
      error: { type: 'forbidden', permission: 'users.manage' },
    });
  });

  it('notFound, conflict, invalid and unauthorized carry their payload', () => {
    expect(notFound('user', 'u1').error).toEqual({ type: 'notFound', entity: 'user', id: 'u1' });
    expect(conflict('emailTaken', 'E-Mail bereits vergeben').error).toEqual({
      type: 'conflict',
      code: 'emailTaken',
      message: 'E-Mail bereits vergeben',
    });
    expect(invalid([{ path: 'name', message: 'required' }]).error).toEqual({
      type: 'validation',
      issues: [{ path: 'name', message: 'required' }],
    });
    expect(unauthorized('locked', { lockedUntil: '2026-09-05T10:00:00.000Z' }).error).toEqual({
      type: 'unauthorized',
      reason: 'locked',
      lockedUntil: '2026-09-05T10:00:00.000Z',
    });
  });

  it('unwrap returns the value or throws on failure', () => {
    expect(unwrap(ok('x'))).toBe('x');
    expect(() => unwrap(forbidden('x'))).toThrow(/unexpected failure/);
  });
});

describe('combineConflicts (N6)', () => {
  it('keeps the first reason and hangs the further localized conflicts on it as also', () => {
    expect(combineConflicts([])).toBeNull();
    const one = localizedConflict('a', 'x.a');
    expect(combineConflicts([one])).toBe(one);
    expect(combineConflicts([one, localizedConflict('b', 'x.b', { n: 1 }), conflict('c', 'ohne Schlüssel')])).toEqual({ ok: false, error: { type: 'conflict', code: 'a', message: 'a', messageKey: 'x.a', params: {}, also: [{ code: 'b', messageKey: 'x.b', params: { n: 1 } }] } });
    const denied = forbidden('p');
    expect(combineConflicts([denied, one])).toBe(denied);
  });
});
