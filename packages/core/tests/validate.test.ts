import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../src/validate';

describe('validate', () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().int() });

  it('returns ok with parsed data', () => {
    expect(validate(schema, { name: 'A', age: 3 })).toEqual({ ok: true, value: { name: 'A', age: 3 } });
  });

  it('maps zod issues to path/message pairs', () => {
    const result = validate(schema, { name: '', age: 1.5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
    if (result.error.type !== 'validation') return;
    expect(result.error.issues.map((i) => i.path)).toEqual(['name', 'age']);
  });
});
