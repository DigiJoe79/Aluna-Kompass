import { readSetting } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { requireSession } from '@/lib/request-context';
import { PasswordForm } from './password-form';

export default async function PasswordPage() {
  const { deps, user } = await requireSession({ allowPasswordChange: true });
  if (!user.mustChangePassword) redirect('/');
  const t = await getTranslations('auth.password');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} organization={readSetting<string>(deps, 'organization.name')} title={t('title')} footer={t('footer')}>
      <p className="text-body text-ink-2">{t('intro')}</p>
      <PasswordForm />
    </AuthCard>
  );
}
