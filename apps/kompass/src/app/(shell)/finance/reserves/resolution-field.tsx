'use client';

import { useTranslations } from 'next-intl';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';

/** Beschluss (Pflicht, Annahme 11): aus der Akte gewählt oder als PDF hochgeladen — das eine leert das andere. */
export function ResolutionField({ id, document, onDocument, onFile }: { id: string; document: PickedDocument | null; onDocument: (d: PickedDocument | null) => void; onFile: (f: File | null) => void }) {
  const t = useTranslations('finance.reserves.resolution');
  return (
    <div className="space-y-1.5">
      <DocumentPicker
        id={id}
        name="resolutionDocumentId"
        label={t('pick')}
        value={document}
        onChange={(d) => {
          onDocument(d);
          if (d) onFile(null);
        }}
      />
      <p className="text-[12px] text-muted-ink">{t('upload')}</p>
      <input
        type="file"
        accept="application/pdf"
        data-testid={`${id}-upload`}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onFile(f);
          if (f) onDocument(null);
        }}
      />
    </div>
  );
}
