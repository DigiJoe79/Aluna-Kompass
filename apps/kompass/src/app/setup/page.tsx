import { isSetupRequired } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getDeps } from '@/lib/deps';
import { SetupForm } from './setup-form';

export default async function SetupPage() {
  if (!isSetupRequired(getDeps())) redirect('/login');
  const t = await getTranslations('auth.setup');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} title={t('title')} width={520} footer={t('footer')}>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('intro')}</p>
      <SetupForm />
    </AuthCard>
  );
}
