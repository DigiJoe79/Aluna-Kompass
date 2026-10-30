import { coreModule, fakeTextExtraction, readSetting, type ProbeResult } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { setOcrLanguages } from '../src/ocr-languages';

/**
 * Befundliste 0.4.0, K1b: Der Abgleich mit Tesseract stand in der Server Action; über `settings_set` ließ sich eine
 * Sprache eintragen, die es in der Umgebung nicht gibt — dann scheitert jede Texterkennung. Jetzt prüft der Dienst.
 */
function setup(opts: { permissions?: string[]; probe?: ProbeResult } = {}) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], textExtraction: fakeTextExtraction({ probe: opts.probe ?? { ok: true, languages: ['deu', 'eng', 'fra'] } }) });
  return { deps, ctx: ctxWith(opts.permissions ?? ['settings.manage'], insertUser(deps, {})) };
}

const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

describe('setOcrLanguages', () => {
  it('saves installed languages and records it', async () => {
    const { deps, ctx } = setup();
    expect(await setOcrLanguages(deps, ctx, { languages: 'deu+fra' })).toEqual({ ok: true, value: { languages: 'deu+fra' } });
    expect(readSetting(deps, 'dms.ocrLanguages')).toBe('deu+fra');
    expect(JSON.parse(auditEntry(deps, 'settings.update')!.params!)).toEqual({ key: 'dms.ocrLanguages' });
  });

  it('refuses a language the environment does not have, and writes nothing', async () => {
    const { deps, ctx } = setup();
    const res = await setOcrLanguages(deps, ctx, { languages: 'deu+ita' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'ocrLanguageMissing', params: { lang: 'ita' } });
    expect(readSetting(deps, 'dms.ocrLanguages')).toBe('deu+eng');
  });

  it('refuses when text recognition is unavailable', async () => {
    const { deps, ctx } = setup({ probe: { ok: false, error: 'tesseract fehlt' } });
    expect(code(await setOcrLanguages(deps, ctx, { languages: 'deu' }))).toBe('ocrUnavailable');
  });

  it('needs settings.manage and a well-formed list', async () => {
    expect(code(await setOcrLanguages(setup({ permissions: [] }).deps, ctxWith([]), { languages: 'deu' }))).toBe('forbidden');
    const { deps, ctx } = setup();
    expect(code(await setOcrLanguages(deps, ctx, { languages: '' }))).toBe('validation');
    expect(code(await setOcrLanguages(deps, ctx, { languages: 'de+en' }))).toBe('validation');
  });
});
