import { z } from 'zod';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { readSetting, writeSettingInternal } from '../settings/service';
import { validate } from '../validate';
import { DEFAULT_THEME } from './default-theme';
import { THEME_KEY_PATTERN, themeSchema, type Theme } from './tokens';

const DEFAULT_KEY = 'default';

export function listThemes(deps: Deps): { themes: Theme[]; activeKey: string } {
  return { themes: readSetting<Theme[]>(deps, 'themes'), activeKey: readSetting<string>(deps, 'branding.activeTheme') };
}

export function resolveActiveTheme(deps: Deps): Theme {
  const { themes, activeKey } = listThemes(deps);
  return themes.find((t) => t.key === activeKey) ?? themes.find((t) => t.key === DEFAULT_KEY) ?? DEFAULT_THEME;
}

function saveThemes(tx: DbOrTx, deps: Deps, ctx: CallContext, themes: Theme[], action: string): Result<Theme[]> {
  const written = writeSettingInternal(tx, deps, ctx, 'themes', themes, action);
  return written.ok ? ok(themes) : written;
}

export async function createTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Theme>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, themeSchema, input);
  if (!parsed.ok) return parsed;
  const theme = parsed.value;
  const { themes } = listThemes(deps);
  if (themes.some((t) => t.key === theme.key)) return conflict('themeKeyTaken', `Theme „${theme.key}“ existiert bereits`);
  return deps.db.transaction((tx) => {
    const saved = saveThemes(tx, deps, ctx, [...themes, theme], 'themes.create');
    return saved.ok ? ok(theme) : saved;
  });
}

export async function updateTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Theme>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, themeSchema, input);
  if (!parsed.ok) return parsed;
  const theme = parsed.value;
  if (theme.key === DEFAULT_KEY) return conflict('themeReadOnly', 'Das Default-Theme ist schreibgeschützt');
  const { themes } = listThemes(deps);
  if (!themes.some((t) => t.key === theme.key)) return notFound('theme', theme.key);
  return deps.db.transaction((tx) => {
    const saved = saveThemes(tx, deps, ctx, themes.map((t) => (t.key === theme.key ? theme : t)), 'themes.update');
    return saved.ok ? ok(theme) : saved;
  });
}

const duplicateSchema = z.object({ sourceKey: z.string().min(1), key: z.string().regex(THEME_KEY_PATTERN), name: z.string().trim().min(1).max(60) });

export async function duplicateTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Theme>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, duplicateSchema, input);
  if (!parsed.ok) return parsed;
  const { themes } = listThemes(deps);
  const source = themes.find((t) => t.key === parsed.value.sourceKey);
  if (!source) return notFound('theme', parsed.value.sourceKey);
  if (themes.some((t) => t.key === parsed.value.key)) return conflict('themeKeyTaken', `Theme „${parsed.value.key}“ existiert bereits`);
  const copy: Theme = { key: parsed.value.key, name: parsed.value.name, tokens: structuredClone(source.tokens) };
  return deps.db.transaction((tx) => {
    const saved = saveThemes(tx, deps, ctx, [...themes, copy], 'themes.duplicate');
    return saved.ok ? ok(copy) : saved;
  });
}

const keySchema = z.object({ key: z.string().min(1) });

export async function deleteTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, keySchema, input);
  if (!parsed.ok) return parsed;
  const { key } = parsed.value;
  if (key === DEFAULT_KEY) return conflict('themeReadOnly', 'Das Default-Theme kann nicht gelöscht werden');
  const { themes, activeKey } = listThemes(deps);
  if (!themes.some((t) => t.key === key)) return notFound('theme', key);
  if (key === activeKey) return conflict('themeActive', 'Das aktive Theme kann nicht gelöscht werden');
  return deps.db.transaction((tx) => {
    const saved = saveThemes(tx, deps, ctx, themes.filter((t) => t.key !== key), 'themes.delete');
    return saved.ok ? ok(undefined) : saved;
  });
}

export async function activateTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Theme>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, keySchema, input);
  if (!parsed.ok) return parsed;
  const { themes } = listThemes(deps);
  const theme = themes.find((t) => t.key === parsed.value.key);
  if (!theme) return notFound('theme', parsed.value.key);
  return deps.db.transaction((tx) => {
    const written = writeSettingInternal(tx, deps, ctx, 'branding.activeTheme', theme.key, 'themes.activate');
    return written.ok ? ok(theme) : written;
  });
}
