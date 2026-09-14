'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { usePreference } from '@/lib/preferences';
import { initials } from '@/lib/utils';

export interface UserMenuProps {
  user: { name: string; roleNames: string[] };
  build: string;
}

/**
 * Sitzt rechts in der Kopfleiste und klappt nach unten. Die Build-Zeile steht
 * als letzte, nicht klickbare Zeile hier, weil der Sidebar-Fuß, der sie trug,
 * entfallen ist.
 */
export function UserMenu({ user, build }: UserMenuProps) {
  const t = useTranslations('shell.userMenu');
  const shell = useTranslations('shell');
  const [scheme, setScheme] = usePreference('colorScheme');
  const [density, setDensity] = usePreference('density');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" aria-label={t('aria')} className="flex h-[38px] max-w-60 items-center gap-2 rounded-md px-1.5 hover:bg-hover">
            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-bold text-on-brand">{initials(user.name)}</span>
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate text-[13px] font-semibold">{user.name}</span>
              <span className="block truncate text-[11px] text-muted-ink">{user.roleNames.join(', ') || t('noRole')}</span>
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-ink" aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent side="bottom" align="end" className="w-56 bg-surface shadow-md">
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
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[10px] text-muted-ink">{shell('build', { id: build })}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
