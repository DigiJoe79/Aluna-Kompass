import { validate } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { markdown, number, select, text } from '@kompass/site-template';
import { blankValue, schemaFor } from '../src/field-schema';
import type { FieldSchema } from '../src/load';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;

describe('schemaFor', () => {
  it('rebuilds bounds from the stored json schema', () => {
    const n = schemaFor(asJson(number({ min: 0, max: 100, label: 'N' })));
    expect(n.safeParse(50).success).toBe(true);
    expect(n.safeParse(200).success).toBe(false);
    expect(n.safeParse(-1).success).toBe(false);

    const t = schemaFor(asJson(text({ max: 5, label: 'T' })));
    expect(t.safeParse('abcde').success).toBe(true);
    expect(t.safeParse('abcdef').success).toBe(false);

    const m = schemaFor(asJson(markdown({ max: 4, label: 'M' })));
    expect(m.safeParse('####').success).toBe(true);
    expect(m.safeParse('#####').success).toBe(false);
  });

  it('accepts any locale key and leaves the locale check to the core', () => {
    const loc = schemaFor(asJson(text({ localized: true, label: 'T' })));
    expect(loc.safeParse({ de: 'hallo', xx: 'ignored by zod' }).success).toBe(true);
    // Erst validate() aus dem Kern schlägt bei einer fremden Sprache an.
    const deps = createTestDeps({ locales: ['de'] });
    const result = validate(deps, loc, { de: 'hallo', xx: 'x' });
    expect(result.ok === false && result.error.type === 'validation' && result.error.issues[0]?.message === 'unknownLocale').toBe(true);
  });

  it('takes a select back to an enum', () => {
    const s = schemaFor(asJson(select(['narrow', 'wide'], { label: 'S' })));
    expect(s.safeParse('narrow').success).toBe(true);
    expect(s.safeParse('huge').success).toBe(false);
  });
});

describe('blankValue', () => {
  it('gives each widget its empty value', () => {
    expect(blankValue(asJson(text({ localized: true })))).toEqual({});
    expect(blankValue(asJson(text({})))).toBe('');
    expect(blankValue(asJson(number({})))).toBe(0);
    expect(blankValue(asJson(select(['a', 'b'])))).toBe('a');
  });
});
