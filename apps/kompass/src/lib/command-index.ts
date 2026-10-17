import type { PermissionSpec } from '@kompass/core';
import { defaultFilter } from 'cmdk';
import { hasAnyOf, type NavGroup } from './navigation';

export interface CommandEntry {
  id: string;
  group: 'navigation' | 'settings' | 'actions' | 'help';
  label: string;
  hint: string;
  href: string;
  permission?: PermissionSpec;
}

export function buildCommandIndex(input: {
  groups: NavGroup[];
  settingsFields: { key: string; tab: string }[];
  permissions: ReadonlySet<string>;
  helpPages?: { doc: string; title: string; chapter: string }[];
  t: (key: string) => string;
}): CommandEntry[] {
  const { t } = input;
  const entries: CommandEntry[] = [];
  for (const group of input.groups) {
    for (const item of group.items) {
      if (!item.visible) continue;
      if (!hasAnyOf(input.permissions, item.permission)) continue;
      entries.push({
        id: `nav:${item.key}`,
        group: 'navigation',
        label: item.label ?? t(item.labelKey),
        hint: t(group.labelKey),
        href: item.href,
        permission: item.permission,
      });
    }
  }
  if (input.permissions.has('settings.manage')) {
    for (const field of input.settingsFields) {
      entries.push({
        id: `setting:${field.key}`,
        group: 'settings',
        label: t(`settings.fields.${field.key}`),
        hint: `${t('nav.settings')} / ${t(`settings.tabs.${field.tab}`)}`,
        href: `/admin/settings?tab=${field.tab}`,
        permission: 'settings.manage',
      });
    }
  }
  for (const page of input.helpPages ?? []) {
    entries.push({ id: `help:${page.doc}`, group: 'help', label: page.title, hint: page.chapter, href: `/help/${page.doc}` });
  }
  return entries;
}

/**
 * Filter der Befehlspalette (01 C36): Ein Eintrag gilt nur, wenn jedes Suchwort als Wortteil in ihm steht —
 * die unscharfe Suche von cmdk fand sonst „Speichern und Meldungen“ für „Spende“. Die Rangfolge unter den
 * Treffern bleibt die von cmdk; Wörter in anderer Reihenfolge zählen mit kleinem Rang.
 */
export function paletteFilter(value: string, search: string): number {
  const words = search.toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const haystack = value.toLocaleLowerCase('de');
  if (!words.every((word) => haystack.includes(word))) return 0;
  return Math.max(defaultFilter!(value, search), 0.01);
}
