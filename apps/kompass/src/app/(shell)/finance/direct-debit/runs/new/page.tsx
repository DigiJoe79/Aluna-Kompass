import { hasPermission, readSetting } from '@kompass/core';
import { getCollectionWindow, getSepaSetupState, listAccounts } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { NewRunFlow } from './new-run-flow';

/** Neuer Einzug (Handoff 2a § 1.2): `standard`, Ablauf mit `Steps bar`; nicht in der Navigation, `back` „Lastschrift“. */
export default async function NewRunPage() {
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.directDebit');
  const setup = await getSepaSetupState(deps, ctx);
  if (!setup.ok) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  // Nicht eingerichtet: Die Liste zeigt den Weg in die Einstellungen (11e).
  if (!setup.value.ready) redirect('/finance/direct-debit');
  const [window, accounts] = await Promise.all([getCollectionWindow(deps, ctx, {}), listAccounts(deps, ctx, {})]);
  if (!window.ok || !accounts.ok) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const usable = accounts.value.filter((a) => a.kind === 'bank' && a.iban).map((a) => ({ id: a.id, name: a.name }));
  const configured = readSetting<string | null>(deps, 'finance.sepa.accountId');
  const main = accounts.value.find((a) => a.isMain && a.kind === 'bank' && a.iban);
  const defaultAccountId = (configured && usable.some((a) => a.id === configured) ? configured : main?.id) ?? usable[0]?.id ?? '';
  return (
    <Page width="standard" header={<PageHeader title={t('newRun.title')} description={t('newRun.description')} back={{ href: '/finance/direct-debit', label: t('list.title') }} />}>
      <NewRunFlow days={window.value.days} accounts={usable} defaultAccountId={defaultAccountId} canCreate={hasPermission(ctx, 'finance.directDebit')} />
    </Page>
  );
}
