import { isSetupRequired } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getDeps } from '@/lib/deps';
import { ImportForm } from './import-form';

// Diese Seite entscheidet anhand der Datenbank, ob eingerichtet werden muss.
// Ohne force-dynamic backt `next build` den Bauzeit-Zustand ein — im Container
// ist die Datenbank dann leer und die Weiterleitung bleibt fuer immer stehen.
export const dynamic = 'force-dynamic';

export default async function SetupImportPage() {
  if (!isSetupRequired(getDeps())) redirect('/login');
  const t = await getTranslations('auth.setupImport');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} title={t('title')} width={520} footer={t('back')}>
      <ImportForm />
    </AuthCard>
  );
}
