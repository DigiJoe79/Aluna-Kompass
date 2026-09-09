'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { buildCommandIndex } from '@/lib/command-index';
import type { NavGroup } from '@/lib/navigation';
import { SETTINGS_TABS } from '@/lib/settings-fields';

export function CommandPalette({ groups, permissions }: { groups: NavGroup[]; permissions: string[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const entries = useMemo(
    () =>
      buildCommandIndex({
        groups,
        settingsFields: SETTINGS_TABS.flatMap((tab) => tab.fields.map((f) => ({ key: f.key, tab: tab.key }))),
        permissions: new Set(permissions),
        t,
      }),
    [groups, permissions, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('kompass:command-palette', onOpen);
    // Strg+K wirkt erst, wenn dieser Effekt gelaufen ist. Ohne ein Merkmal am
    // DOM kann ein Test das nicht abwarten und drückt ins Leere — auf einem
    // langsamen Läufer zuverlässig, hier nie.
    document.body.dataset.commandPalette = 'ready';
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('kompass:command-palette', onOpen);
      delete document.body.dataset.commandPalette;
    };
  }, []);

  const groupsOf = (g: 'navigation' | 'settings' | 'actions') => entries.filter((e) => e.group === g);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="top-24 w-[600px] translate-y-0 bg-surface p-0 shadow-md">
        <DialogTitle className="sr-only">{t('palette.aria')}</DialogTitle>
        <Command label={t('palette.aria')}>
          <CommandInput placeholder={t('palette.placeholder')} />
          <CommandList>
            <CommandEmpty>{t('palette.empty')}</CommandEmpty>
            {(['navigation', 'settings'] as const)
              .filter((g) => groupsOf(g).length > 0)
              .map((g) => (
                <CommandGroup key={g} heading={t(`palette.groups.${g}`)}>
                  {groupsOf(g).map((e) => (
                    <CommandItem
                      key={e.id}
                      value={`${e.label} ${e.hint}`}
                      onSelect={() => {
                        setOpen(false);
                        router.push(e.href);
                      }}
                      className="flex items-center gap-3 data-[selected=true]:bg-selected data-[selected=true]:text-selected-ink"
                    >
                      <span className="flex-1">{e.label}</span>
                      <span className="text-[12px] text-muted-ink">{e.hint}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
          </CommandList>
          <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-3 py-2 text-[11px] text-muted-ink">
            <span>↑↓ {t('palette.select')}</span>
            <span>↵ {t('palette.open')}</span>
            <span>esc {t('palette.close')}</span>
            <span className="ml-auto">{t('palette.permissionsOnly')}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
