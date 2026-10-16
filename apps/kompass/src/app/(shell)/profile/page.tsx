import { listApiTokens } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { StatusBadge } from '@/components/status-badge';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { initials } from '@/lib/utils';
import { requireSession } from '@/lib/request-context';
import { ApiTokens } from './api-tokens';
import { ProfilePasswordForm } from './password-form';

export default async function ProfilePage() {
  const { deps, ctx, user } = await requireSession();
  const t = await getTranslations('profile');
  const tokens = await listApiTokens(deps, ctx);
  return (
    <Page width="standard" header={<PageHeader title={t('title')} />}>
      {/* Auch einspaltig `minmax(0,1fr)`: Eine `auto`-Spalte wuchs am Telefon auf die Breite der Token-Tabelle (576 statt
          390 px), und Tabelle und Passwortformular ragten rechts hinaus (Befund 1 Nr. 1, 0.2.12). Die Tabelle scrollt in
          ihrem eigenen Behälter (`ui/table`). Ohne dauerhaften Test — ein Layoutfehler an einer Stelle (Projektregel). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-brand text-[15px] font-bold text-on-brand">
                {initials(user.name)}
              </span>
              <div>
                <div className="text-section">{user.name}</div>
                <div className="text-meta text-muted-ink">{user.email}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.roles.map((r) => (
                <StatusBadge key={r.id} tone="brand">
                  {r.name}
                </StatusBadge>
              ))}
            </div>
            <p className="text-hint text-muted-ink">{t('identityHint')}</p>
          </section>
          <ProfilePasswordForm />
        </div>
        <ApiTokens tokens={tokens.ok ? tokens.value : []} />
      </div>
    </Page>
  );
}
