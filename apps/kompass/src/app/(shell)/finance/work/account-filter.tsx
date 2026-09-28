'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { workHref, type WorkTabKey } from '@/lib/finance/work';

/** Welches Konto die Liste zeigt — steht in der Adresse wie der Reiter; danach geht der Fokus in die Liste, damit die Tasten gleich wirken. */
export function AccountFilter({ accounts, value, tab }: { accounts: { id: string; name: string }[]; value: string | null; tab: WorkTabKey }) {
  const t = useTranslations('finance.work');
  const router = useRouter();
  return (
    <div className="w-56 space-y-1">
      <Label htmlFor="work-account">{t('accountFilter')}</Label>
      <Select
        id="work-account"
        value={value ?? ''}
        onChange={(e) => {
          router.replace(workHref({ tab, account: e.target.value || null }), { scroll: false });
          e.currentTarget.blur();
        }}
      >
        <option value="">{t('allAccounts')}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
