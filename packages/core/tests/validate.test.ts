import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestDeps } from '../src/testing';
import { validate, VALIDATION_MESSAGE_CODES } from '../src/validate';

describe('validate', () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().int() });
  const deps = createTestDeps();

  it('returns ok with parsed data', () => {
    expect(validate(deps, schema, { name: 'A', age: 3 })).toEqual({ ok: true, value: { name: 'A', age: 3 } });
  });

  it('maps zod issues to path/message pairs', () => {
    const result = validate(deps, schema, { name: '', age: 1.5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
    if (result.error.type !== 'validation') return;
    expect(result.error.issues.map((i) => i.path)).toEqual(['name', 'age']);
  });
});

/**
 * Nachtrag Rest 0.2.0, Task M: Keine Zod-Standardmeldung verlässt `validate` — jede wird ein Code mit
 * Parametern, den Oberfläche und MCP aus der Sprachdatei übersetzen („Too small: expected number to be >0“
 * kam über MCP roh und englisch an).
 */
describe('validate maps every zod default message to a code', () => {
  const deps = createTestDeps();
  const schema = z.object({
    positive: z.number().int().positive(),
    atLeastZero: z.number().int().min(0),
    atMost: z.number().max(10),
    below: z.number().lt(10),
    whole: z.number().int(),
    name: z.string().min(1),
    short: z.string().min(3),
    long: z.string().max(3),
    date: z.string().date(),
    mail: z.string().email(),
    choice: z.enum(['a', 'b']),
    list: z.array(z.string()).min(1),
    few: z.array(z.string()).max(1),
    missing: z.string(),
    wrongType: z.string(),
    custom: z.number().refine((v) => v !== 0, 'amountCentsRequired'),
  });
  const input = { positive: -5, atLeastZero: -1, atMost: 11, below: 10, whole: 1.5, name: '', short: 'ab', long: 'abcd', date: '2026-13-01', mail: 'nope', choice: 'c', list: [], few: ['a', 'b'], wrongType: 5, custom: 0 };

  function issues() {
    const result = validate(deps, schema, input);
    if (result.ok || result.error.type !== 'validation') throw new Error('expected a validation failure');
    return Object.fromEntries(result.error.issues.map((i) => [i.path, { message: i.message, ...(i.params ? { params: i.params } : {}) }]));
  }

  it('turns each default message into a code with its parameters', () => {
    expect(issues()).toEqual({
      positive: { message: 'mustBeGreater', params: { minimum: 0 } },
      atLeastZero: { message: 'tooSmall', params: { minimum: 0 } },
      atMost: { message: 'tooBig', params: { maximum: 10 } },
      below: { message: 'mustBeLess', params: { maximum: 10 } },
      whole: { message: 'notInteger' },
      name: { message: 'required' },
      short: { message: 'tooShort', params: { minimum: 3 } },
      long: { message: 'tooLong', params: { maximum: 3 } },
      date: { message: 'invalidDate' },
      mail: { message: 'email' },
      choice: { message: 'invalidOption', params: { options: 'a, b' } },
      list: { message: 'required' },
      few: { message: 'tooManyItems', params: { maximum: 1 } },
      missing: { message: 'required' },
      wrongType: { message: 'invalid' },
      custom: { message: 'amountCentsRequired' },
    });
  });

  it('only ever yields codes, never a sentence', () => {
    for (const { message } of Object.values(issues())) expect(message).toMatch(/^[a-z][A-Za-z0-9]*$/);
  });

  it('names the codes it can produce, for the language file guard', () => {
    const produced = new Set(Object.values(issues()).map((i) => i.message));
    produced.delete('amountCentsRequired');
    for (const code of produced) expect(VALIDATION_MESSAGE_CODES).toContain(code);
  });
});
