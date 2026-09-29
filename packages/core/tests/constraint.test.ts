import { describe, expect, it, vi } from 'vitest';
import { guardConstraint, isConstraintError, ok, schema } from '../src';
import { createTestDeps } from '../src/testing';

/** N1: Kein Dienst reicht einen rohen SQLite-Fehler an Oberfläche oder MCP durch. */
describe('guardConstraint', () => {
  it('turns a violated foreign key into a conflict with a text from the language file and logs the cause', async () => {
    const deps = createTestDeps();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await guardConstraint('test.tool', async () => {
      deps.db.insert(schema.userRoles).values({ userId: 'NOPE', roleId: 'NOPE' }).run();
      return ok(null);
    });
    expect(result).toEqual({ ok: false, error: { type: 'conflict', code: 'databaseConstraint', message: 'databaseConstraint', messageKey: 'errors.databaseConstraint', params: {} } });
    expect(JSON.stringify(result)).not.toMatch(/FOREIGN KEY/);
    expect(log).toHaveBeenCalledWith('[db] %s', 'test.tool', expect.objectContaining({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }));
    log.mockRestore();
  });

  it('passes results through and rethrows every other error', async () => {
    expect(await guardConstraint('x', async () => ok(1))).toEqual({ ok: true, value: 1 });
    await expect(guardConstraint('x', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(isConstraintError(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }))).toBe(true);
    expect(isConstraintError(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }))).toBe(false);
    expect(isConstraintError('SQLITE_CONSTRAINT')).toBe(false);
  });
});
