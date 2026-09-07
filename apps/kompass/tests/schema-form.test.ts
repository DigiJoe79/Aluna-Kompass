import { schemaFor } from '@kompass/module-site/client';
import type { FieldSchema } from '@kompass/module-site/client';
import { createTestDeps } from '@kompass/core/testing';
import { validate } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { blankFor, setAtPath, withBlanks } from '@/components/schema-form/state';

const LOCALIZED: FieldSchema = { widget: 'localized', label: 'T', max: 500 };
const NUMBER = (min: number, max: number): FieldSchema => ({ widget: 'number', type: 'number', minimum: min, maximum: max, label: 'N' });
const ASSET: FieldSchema = { widget: 'asset', label: 'A', type: ['string', 'null'] };
const SELECT: FieldSchema = { widget: 'select', enum: ['narrow', 'wide'], label: 'S' };

describe('setAtPath', () => {
  it('writes into nested objects without touching siblings', () => {
    const before = { title: { de: 'Hallo', en: 'Hi' }, body: 'x' };
    const after = setAtPath(before, 'title.en', 'Hello');
    expect(after).toEqual({ title: { de: 'Hallo', en: 'Hello' }, body: 'x' });
    expect(before.title.en).toBe('Hi');
  });

  it('writes into a list by index and keeps the other entries', () => {
    const before = { blocks: [{ href: 'a' }, { href: 'b' }, { href: 'c' }] };
    const after = setAtPath(before, 'blocks.1.href', 'B') as { blocks: { href: string }[] };
    expect(after.blocks.map((b) => b.href)).toEqual(['a', 'B', 'c']);
    expect(before.blocks[1]!.href).toBe('b');
  });
});

describe('blankFor', () => {
  it('gives a localized field one empty string per locale', () => {
    expect(blankFor(LOCALIZED, ['de', 'en'])).toEqual({ de: '', en: '' });
  });

  it('gives a list an empty array, an asset null, a number zero, a select its first value', () => {
    expect(blankFor({ widget: 'list', type: 'array' })).toEqual([]);
    expect(blankFor(ASSET)).toBe(null);
    expect(blankFor(NUMBER(0, 10))).toBe(0);
    expect(blankFor(SELECT)).toBe('narrow');
  });
});

describe('withBlanks', () => {
  it('adds missing fields and missing locales', () => {
    const schema = { claim: LOCALIZED, count: NUMBER(0, 9) };
    expect(withBlanks(schema, { claim: { de: 'da' } }, ['de', 'en'])).toEqual({ claim: { de: 'da', en: '' }, count: 0 });
  });
});

describe('schemaFor', () => {
  it('rebuilds bounds from the stored json schema', () => {
    const n = schemaFor(NUMBER(0, 100));
    expect(n.safeParse(50).success).toBe(true);
    expect(n.safeParse(200).success).toBe(false);
  });

  it('accepts any locale key and leaves the locale check to the core', () => {
    const loc = schemaFor(LOCALIZED);
    expect(loc.safeParse({ de: 'x', fr: 'y' }).success).toBe(true);
    const deps = createTestDeps({ locales: ['de'] });
    expect(validate(deps, loc, { de: 'x', fr: 'y' }).ok).toBe(false);
  });
});
