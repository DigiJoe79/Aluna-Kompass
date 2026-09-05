import { isSetupRequired, readSetting } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { LoginForm } from './login-form';

export default async function LoginPage(props: { searchParams: Promise<{ imported?: string }> }) {
  const deps = getDeps();
  if (isSetupRequired(deps)) redirect('/setup');
  if (await optionalSession()) redirect('/');
  const { imported } = await props.searchParams;
  const t = await getTranslations('auth.login');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} organization={readSetting<string>(deps, 'organization.name')} title={t('title')} footer={t('footer')}>
      <LoginForm imported={imported === '1'} />
    </AuthCard>
  );
}
