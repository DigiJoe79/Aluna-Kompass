import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('app');
  return <main>{t('name')}</main>;
}
