'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { FilterBar, selectFilter } from '@/components/filter-bar';
import { workHref, type WorkTabKey } from '@/lib/finance/work';

/**
 * Die Leiste der Arbeitsliste (Spec Filterleisten § 4): ein Filter „Konto“, die Zählzeile des Reiters und „Filter
 * zurücksetzen“. Das Konto steht in der Adresse wie der Reiter; nach der Wahl geht der Fokus aus dem Feld, damit die
 * Tasten der Liste gleich wirken.
 */
export function AccountFilter({
  accounts,
  value,
  tab,
  count,
}: {
  accounts: { id: string; name: string }[];
  value: string | null;
  tab: WorkTabKey;
  count: { shown: number; total: number };
}) {
  const t = useTranslations('finance.work');
  const router = useRouter();
  const choose = (account: string) => {
    router.replace(workHref({ tab, account: account || null }), { scroll: false });
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  const noun = tab === 'open' || tab === 'unsure' ? 'transactions' : tab === 'due' ? 'openItems' : 'drafts';
  return (
    <FilterBar
      filters={[selectFilter({ key: 'account', label: t('accountFilter'), value: value ?? '', options: accounts.map((a) => ({ value: a.id, label: a.name })), onChange: choose })]}
      onApply={(values) => choose(values.account ?? '')}
      count={{ ...count, noun: { one: t(`noun.${noun}.one`), other: t(`noun.${noun}.other`), dative: t(`noun.${noun}.dative`) } }}
      onReset={() => choose('')}
      testId="work-filter-bar"
    />
  );
}
