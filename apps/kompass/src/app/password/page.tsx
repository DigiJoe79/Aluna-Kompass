import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { requireSession } from '@/lib/request-context';
import { PasswordForm } from './password-form';

export default async function PasswordPage() {
  const { user } = await requireSession({ allowPasswordChange: true });
  if (!user.mustChangePassword) redirect('/');
  const t = await getTranslations('auth.password');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} title={t('title')} width={360} footer={t('footer')}>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('intro')}</p>
      <PasswordForm />
    </AuthCard>
  );
}
