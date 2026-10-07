import { requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { HydrationMarker } from '@/components/hydration-marker';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { PreviewFrameClient } from './preview-frame-client';

export default async function PreviewFramePage() {
  const { ctx } = await requireSession();
  if (requirePermission(ctx, 'site.view')) return <ForbiddenCard permission="site.view" />;
  const t = await getTranslations('site.previewFrame');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} back={{ href: '/site/publish', label: t('back') }} />
      <PreviewFrameClient />
      {/* Ohne `Page` (Ausnahme in tests/patterns/page-width.test.ts) — der Marker steht deshalb hier. */}
      <HydrationMarker />
    </div>
  );
}
