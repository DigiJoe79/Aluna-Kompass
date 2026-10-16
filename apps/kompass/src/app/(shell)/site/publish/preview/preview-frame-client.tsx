'use client';

import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Segmented } from '@/components/ui/segmented';

/** Telefon und Tablet als feste Breite; Desktop ist die volle Breite der Seite. */
export const PREVIEW_WIDTHS = { desktop: null, tablet: 820, mobile: 390 } as const;
type Width = keyof typeof PREVIEW_WIDTHS;
const WIDTH_ICONS = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const;

export function PreviewFrameClient() {
  const t = useTranslations('site.previewFrame');
  const [width, setWidth] = useState<Width>('desktop');
  return (
    <div className="space-y-4">
      {/* Einzige Stelle mit Symbolen statt Text (Spec § 3.7.1); der Name steht im aria-label je Option. */}
      <Segmented
        aria-label={t('widths.label')}
        options={(Object.keys(PREVIEW_WIDTHS) as Width[]).map((key) => {
          const Icon = WIDTH_ICONS[key];
          return { value: key, label: <Icon className="size-4" aria-hidden />, ariaLabel: `${t(`widths.${key}`)}${PREVIEW_WIDTHS[key] ? ` · ${PREVIEW_WIDTHS[key]}px` : ''}` };
        })}
        value={width}
        onValueChange={setWidth}
      />
      <div className="overflow-x-auto rounded-md border border-line bg-paper">
        <iframe
          src="/site/preview/"
          title={t('frameTitle')}
          style={{ width: PREVIEW_WIDTHS[width] ? `${PREVIEW_WIDTHS[width]}px` : '100%', maxWidth: '100%' }}
          className="block h-[80vh] border-0"
        />
      </div>
    </div>
  );
}
