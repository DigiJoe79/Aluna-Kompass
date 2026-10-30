'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/**
 * Beschluss (Pflicht, Annahme 11): aus der Akte gewählt oder als PDF hochgeladen — das eine leert das andere. Ein Muster
 * wie das Dokument der Umwidmung und der Beleg (Runde 3, 124, wie 087): die Ablagefläche mit „Aus der Akte wählen“, die
 * Suche in der Akte erst danach; ist etwas gewählt, steht es als Zeile mit „Entfernen“. Das Hochladen läuft über
 * `ReceiptDrop` statt eines sichtbaren Datei-Felds (09 A3). `label`/`pickLabel`/`required` für einen anderen Beleg im
 * selben Muster (Anfangsvortrag der Mittelverwendung, Plan U2: „Beleg“, beim Bearbeiten optional).
 */
export function ResolutionField({ id, document, onDocument, onFile, label, pickLabel, required = true }: { id: string; document: PickedDocument | null; onDocument: (d: PickedDocument | null) => void; onFile: (f: File | null) => void; label?: string; pickLabel?: string; required?: boolean }) {
  const t = useTranslations('finance.reserves.resolution');
  const tReceipt = useTranslations('finance.receipt');
  const [fileName, setFileName] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label required={required} className="text-meta font-semibold text-ink-2">
        {label ?? t('label')}
      </Label>
      {document || fileName ? (
        <p className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 text-meta" data-testid={`${id}-chosen`}>
          {document ? <span className="font-mono text-hint">{document.number}</span> : null}
          <span className="min-w-0 flex-1 truncate">{document ? document.subject : t('chosenFile', { name: fileName ?? '' })}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              onDocument(null);
              onFile(null);
              setFileName(null);
            }}
          >
            {tReceipt('remove')}
          </Button>
        </p>
      ) : (
        <>
          <div data-testid={`${id}-upload`}>
            <ReceiptDrop
              onPickFromArchive={() => setArchiveOpen(true)}
              onFiles={(files) => {
                const f = files[0] ?? null;
                onFile(f);
                setFileName(f?.name ?? null);
                if (f) onDocument(null);
              }}
            />
          </div>
          {archiveOpen ? (
            <DocumentPicker
              id={id}
              name="resolutionDocumentId"
              label={pickLabel ?? t('pick')}
              value={null}
              onChange={(d) => {
                if (!d) return;
                onDocument(d);
                onFile(null);
                setFileName(null);
                setArchiveOpen(false);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
