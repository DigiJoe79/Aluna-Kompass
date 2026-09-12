import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import { PreviewFrameClient } from './preview-frame-client';

export default async function PreviewFramePage() {
  const t = await getTranslations('site.previewFrame');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <PreviewFrameClient />
    </div>
  );
}
