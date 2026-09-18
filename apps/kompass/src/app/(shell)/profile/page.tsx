import { listApiTokens } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { StatusBadge } from '@/components/status-badge';
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
    <>
      <PageHeader title={t('title')} />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-brand text-[15px] font-bold text-on-brand">
                {initials(user.name)}
              </span>
              <div>
                <div className="text-[15px] font-semibold">{user.name}</div>
                <div className="text-[13px] text-muted-ink">{user.email}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.roles.map((r) => (
                <StatusBadge key={r.id} tone="brand">
                  {r.name}
                </StatusBadge>
              ))}
            </div>
            <p className="text-[12px] text-muted-ink">{t('identityHint')}</p>
          </section>
          <ProfilePasswordForm />
        </div>
        <ApiTokens tokens={tokens.ok ? tokens.value : []} />
      </div>
    </>
  );
}
