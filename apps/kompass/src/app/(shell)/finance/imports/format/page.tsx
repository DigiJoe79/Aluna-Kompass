import { hasPermission, listUserNamesWithPermission } from '@kompass/core';
import { listAccounts, listImportProfiles } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { CsvAssistant, type AssistantAccount } from './csv-assistant';

/**
 * CSV-Format einrichten (F4b Task 5, B3). Einrichten darf, wer
 * `finance.setup` trägt (Rückmeldung Phase 2, Punkt 3); wer nur lesen darf,
 * sieht, wer es kann. `?account=` wählt das Konto vor; `?reselect=1` sagt, dass die
 * Datei aus der Ablagefläche nicht mitkam (N3, W-1) — man wählt sie hier erneut.
 */
export default async function CsvFormatPage({ searchParams }: { searchParams: Promise<{ account?: string; reselect?: string }> }) {
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.csvAssistant');
  const query = await searchParams;

  if (!hasPermission(ctx, 'finance.setup')) {
    if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.setup" />;
    const names = listUserNamesWithPermission(deps, 'finance.setup');
    return (
      <div className="max-w-[760px] space-y-6">
        <PageHeader title={t('title')} />
        <BlockedState step={t('title')} title={t('blocked.title')}>
          {names.length > 0 ? t('blocked.text', { names: names.join(', ') }) : t('blocked.nobody')}
        </BlockedState>
      </div>
    );
  }

  const [accountsRes, profilesRes] = await Promise.all([listAccounts(deps, ctx, {}), listImportProfiles(deps, ctx, {})]);
  if (!accountsRes.ok || !profilesRes.ok) return <ForbiddenCard permission="finance.setup" />;
  const signatureById = new Map(profilesRes.value.profiles.map((p) => [p.id, p.headerSignature]));
  const accounts: AssistantAccount[] = accountsRes.value
    .filter((a) => a.isActive && (a.kind === 'bank' || a.kind === 'paymentService'))
    .map((a) => ({ id: a.id, name: a.name, importFormat: a.importFormat, headerSignature: a.importProfileId ? (signatureById.get(a.importProfileId) ?? null) : null }));

  return (
    <div className="max-w-[1100px] space-y-6">
      <PageHeader title={t('title')} />
      <CsvAssistant accounts={accounts} initialAccountId={accounts.some((a) => a.id === query.account) ? query.account! : (accounts[0]?.id ?? '')} canLoad={hasPermission(ctx, 'finance.entriesWrite')} reselect={query.reselect === '1'} />
    </div>
  );
}
