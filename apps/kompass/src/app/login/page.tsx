import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

export default async function LoginPage() {
  const t = await getTranslations('auth.login');
  return (
    <main className="p-8">
      <Button>{t('submit')}</Button>
    </main>
  );
}
