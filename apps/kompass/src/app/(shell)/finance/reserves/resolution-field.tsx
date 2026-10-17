'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';

/**
 * Beschluss (Pflicht, Annahme 11): aus der Akte gewählt oder als PDF hochgeladen — das eine leert das andere. Das
 * Hochladen läuft über die Ablagefläche `ReceiptDrop` statt eines sichtbaren Datei-Felds (09 A3).
 */
export function ResolutionField({ id, document, onDocument, onFile }: { id: string; document: PickedDocument | null; onDocument: (d: PickedDocument | null) => void; onFile: (f: File | null) => void }) {
  const t = useTranslations('finance.reserves.resolution');
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <DocumentPicker
        id={id}
        name="resolutionDocumentId"
        label={t('pick')}
        value={document}
        onChange={(d) => {
          onDocument(d);
          if (d) {
            onFile(null);
            setFileName(null);
          }
        }}
      />
      <p className="text-hint text-muted-ink">{t('upload')}</p>
      <div data-testid={`${id}-upload`}>
        <ReceiptDrop
          onFiles={(files) => {
            const f = files[0] ?? null;
            onFile(f);
            setFileName(f?.name ?? null);
            if (f) onDocument(null);
          }}
        />
      </div>
      {fileName ? <p className="text-meta text-ink-2">{t('chosenFile', { name: fileName })}</p> : null}
    </div>
  );
}
