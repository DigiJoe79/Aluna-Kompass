'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { usePreference } from '@/lib/preferences';
import { cn, initials } from '@/lib/utils';

export interface UserMenuProps {
  user: { name: string; roleNames: string[] };
  collapsed: boolean;
  trigger?: ReactNode;
}

export function UserMenu({ user, collapsed, trigger }: UserMenuProps) {
  const t = useTranslations('shell.userMenu');
  const [scheme, setScheme] = usePreference('colorScheme');
  const [density, setDensity] = usePreference('density');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" aria-label={t('aria')} className={cn('flex w-full items-center gap-2.5 rounded-md p-2 hover:bg-hover', collapsed && 'justify-center')}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-bold text-on-brand">{initials(user.name)}</span>
            {collapsed ? null : (
              <span className="min-w-0 flex-1 text-left leading-tight">
                <span className="block truncate text-[13px] font-semibold">{user.name}</span>
                <span className="block truncate text-[11px] text-muted-ink">{user.roleNames.join(', ') || t('noRole')}</span>
              </span>
            )}
            {collapsed ? null : trigger}
          </button>
        }
      />
      <DropdownMenuContent side="top" align="start" className="w-56 bg-surface shadow-md">
        <DropdownMenuItem render={<Link href="/profile" />}>{t('profile')}</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={scheme === 'dark'} onCheckedChange={(checked) => setScheme(checked ? 'dark' : 'light')}>{t('dark')}</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as typeof density)}>
          <DropdownMenuRadioItem value="compact">{t('densityCompact')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="default">{t('densityDefault')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">{t('densityComfortable')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <form action="/logout" method="post">
          <DropdownMenuItem nativeButton render={<button type="submit" className="w-full text-left" />}>{t('logout')}</DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
