import { describe, expect, it } from 'vitest';
import { auditLog, settings } from '../src/db/schema';
import { unwrap } from '../src/result';
import { readSetting } from '../src/settings/service';
import { createTestDeps, ctxWith } from '../src/testing';
import { DEFAULT_THEME } from '../src/themes/default-theme';
import { activateTheme, createTheme, deleteTheme, duplicateTheme, listThemes, resolveActiveTheme, updateTheme } from '../src/themes/service';

const admin = ctxWith(['settings.manage']);
const club = { ...DEFAULT_THEME, key: 'vereinsfarben', name: 'Vereinsfarben' };

/**
 * Ein Theme, wie es eine Installation vor den sieben neuen Finanz-Tokens
 * gespeichert hätte: alle bekannten Tokens, die sieben neuen fehlen. Direkt
 * in die Einstellung geschrieben — am strikten Schema vorbei, wie es ein
 * alter Datenbestand tut.
 */
function oldStoredTheme(key: string, name: string, overrides: Partial<Record<string, { light: string; dark: string }>> = {}) {
  const { 'color-final': _1, 'color-final-bg': _2, 'color-agent': _3, 'color-agent-bg': _4, 'color-amount-out': _5, 'color-key-bg': _6, 'color-key-ink': _7, ...oldTokens } = DEFAULT_THEME.tokens as Record<string, { light: string; dark: string }>;
  return { key, name, tokens: { ...oldTokens, ...overrides } };
}

describe('theme service', () => {
  it('starts with the default theme active', () => {
    const deps = createTestDeps();
    expect(listThemes(deps)).toEqual({ themes: [DEFAULT_THEME], activeKey: 'default' });
    expect(resolveActiveTheme(deps).key).toBe('default');
  });

  it('creates, updates and activates a theme with audit entries', async () => {
    const deps = createTestDeps();
    unwrap(await createTheme(deps, admin, club));
    const renamed = unwrap(await updateTheme(deps, admin, { ...club, name: 'Aluna' }));
    expect(renamed.name).toBe('Aluna');
    unwrap(await activateTheme(deps, admin, { key: 'vereinsfarben' }));
    expect(resolveActiveTheme(deps).name).toBe('Aluna');
    expect(readSetting(deps, 'branding.activeTheme')).toBe('vereinsfarben');
    const actions = deps.db.select().from(auditLog).all().map((e) => e.action);
    expect(actions).toEqual(['themes.create', 'themes.update', 'themes.activate']);
  });

  it('rejects duplicate keys, edits to default, invalid themes and missing permission', async () => {
    const deps = createTestDeps();
    unwrap(await createTheme(deps, admin, club));
    const dup = await createTheme(deps, admin, club);
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'themeKeyTaken').toBe(true);
    const ro = await updateTheme(deps, admin, { ...DEFAULT_THEME, name: 'X' });
    expect(ro.ok === false && ro.error.type === 'conflict' && ro.error.code === 'themeReadOnly').toBe(true);
    const bad = await createTheme(deps, admin, { key: 'x', name: 'X', tokens: {} });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
    const denied = await createTheme(deps, ctxWith(['users.manage']), { ...club, key: 'y' });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('duplicates with all token values prefilled', async () => {
    const deps = createTestDeps();
    const copy = unwrap(await duplicateTheme(deps, admin, { sourceKey: 'default', key: 'kopie', name: 'Kopie' }));
    expect(copy.tokens).toEqual(DEFAULT_THEME.tokens);
    expect(listThemes(deps).themes.map((t) => t.key)).toEqual(['default', 'kopie']);
  });

  it('deletes only inactive non-default themes', async () => {
    const deps = createTestDeps();
    unwrap(await createTheme(deps, admin, club));
    const def = await deleteTheme(deps, admin, { key: 'default' });
    expect(def.ok === false && def.error.type === 'conflict' && def.error.code === 'themeReadOnly').toBe(true);
    unwrap(await activateTheme(deps, admin, { key: 'vereinsfarben' }));
    const active = await deleteTheme(deps, admin, { key: 'vereinsfarben' });
    expect(active.ok === false && active.error.type === 'conflict' && active.error.code === 'themeActive').toBe(true);
    unwrap(await activateTheme(deps, admin, { key: 'default' }));
    unwrap(await deleteTheme(deps, admin, { key: 'vereinsfarben' }));
    expect(listThemes(deps).themes).toHaveLength(1);
    const missing = await deleteTheme(deps, admin, { key: 'vereinsfarben' });
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
  });

  it('fills tokens a stored theme does not know from the default theme', () => {
    const deps = createTestDeps();
    const stored = oldStoredTheme('vereinsfarben', 'Alte Vereinsfarben', { 'color-primary': { light: '#123456', dark: '#654321' } });
    const now = '2020-01-01T00:00:00.000Z';
    deps.db.insert(settings).values({ key: 'themes', value: JSON.stringify([stored]), updatedAt: now, updatedByUserId: null }).run();
    deps.db.insert(settings).values({ key: 'branding.activeTheme', value: JSON.stringify('vereinsfarben'), updatedAt: now, updatedByUserId: null }).run();

    const active = resolveActiveTheme(deps);
    expect(active.tokens).toHaveProperty('color-final');
    expect(active.tokens['color-final']).toEqual(DEFAULT_THEME.tokens['color-final']);
    expect(active.tokens['color-primary']).toEqual({ light: '#123456', dark: '#654321' }); // eigene Werte bleiben unangetastet

    const listed = listThemes(deps).themes.find((t) => t.key === 'vereinsfarben')!;
    expect(listed.tokens).toHaveProperty('color-agent-bg');
    expect(listed.tokens['color-agent-bg']).toEqual(DEFAULT_THEME.tokens['color-agent-bg']);
  });

  it('writes the filled theme back when it is saved the next time', async () => {
    const deps = createTestDeps();
    const stored = oldStoredTheme('vereinsfarben', 'Alte Vereinsfarben');
    deps.db.insert(settings).values({ key: 'themes', value: JSON.stringify([stored]), updatedAt: '2020-01-01T00:00:00.000Z', updatedByUserId: null }).run();

    const filled = listThemes(deps).themes.find((t) => t.key === 'vereinsfarben')!;
    expect(filled.tokens).toHaveProperty('color-final'); // strikte Validierung besteht nur, wenn schon aufgefuellt wurde
    const saved = unwrap(await updateTheme(deps, admin, filled));
    expect(saved.tokens['color-final']).toEqual(DEFAULT_THEME.tokens['color-final']);
  });
});
