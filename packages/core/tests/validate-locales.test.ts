import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { localizedText } from '../src/i18n/localized';
import { setSetting } from '../src/settings/service';
import { validate } from '../src/validate';

const schema = z.object({ title: localizedText({ required: true, max: 50 }), note: localizedText() });

async function depsWith(locales: string[]) {
  const deps = createTestDeps();
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: locales });
  return deps;
}

describe('validate with locales', () => {
  it('rejects a locale the installation does not keep', async () => {
    const deps = await depsWith(['de', 'en']);
    const result = validate(deps, schema, { title: { de: 'A', kl: 'B' }, note: {} });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'validation') {
      expect(result.error.issues).toEqual([{ path: 'title.kl', message: 'unknownLocale' }]);
    }
  });

  it('demands the leading locale where the field is required', async () => {
    const deps = await depsWith(['de', 'en']);
    const missing = validate(deps, schema, { title: { de: '', en: 'A' }, note: {} });
    expect(missing.ok).toBe(false);
    if (!missing.ok && missing.error.type === 'validation') {
      expect(missing.error.issues).toEqual([{ path: 'title.de', message: 'required' }]);
    }
    expect(validate(deps, schema, { title: { de: 'A' }, note: {} }).ok).toBe(true);
  });

  it('leaves optional fields and other locales alone', async () => {
    const deps = await depsWith(['de', 'en']);
    expect(validate(deps, schema, { title: { de: 'A' }, note: { en: 'only english' } }).ok).toBe(true);
  });
});

describe('validate reaches nested schemas', () => {
  const nested = z.object({
    title: localizedText({ required: true, max: 50 }),
    blocks: z.array(z.object({ id: z.string(), label: localizedText(), inner: z.object({ note: localizedText() }) })),
  });

  it('rejects an unknown locale inside a list entry, naming its path', async () => {
    const deps = await depsWith(['de', 'en']);
    const result = validate(deps, nested, { title: { de: 'A' }, blocks: [{ id: 'b1', label: { de: 'x' }, inner: { note: { de: 'n' } } }, { id: 'b2', label: { de: 'y', kl: 'z' }, inner: { note: { de: 'n' } } }] });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'validation') {
      expect(result.error.issues).toEqual([{ path: 'blocks.1.label.kl', message: 'unknownLocale' }]);
    }
  });

  it('rejects an unknown locale two objects deep', async () => {
    const deps = await depsWith(['de', 'en']);
    const result = validate(deps, nested, { title: { de: 'A' }, blocks: [{ id: 'b1', label: { de: 'x' }, inner: { note: { de: 'n', kl: 'q' } } }] });
    expect(result.ok === false && result.error.type === 'validation' && result.error.issues[0]!.path).toBe('blocks.0.inner.note.kl');
  });

  it('accepts a well-formed nested value', async () => {
    const deps = await depsWith(['de', 'en']);
    expect(validate(deps, nested, { title: { de: 'A' }, blocks: [{ id: 'b1', label: { de: 'x', en: 'y' }, inner: { note: { en: 'n' } } }] }).ok).toBe(true);
  });
});
