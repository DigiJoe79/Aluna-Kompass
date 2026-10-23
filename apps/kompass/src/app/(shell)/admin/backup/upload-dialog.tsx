'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/app/(shell)/dms/receive/file-dropzone';
import { useDateFormat } from '@/components/date-format-provider';
import { FormField } from '@/components/forms/form-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { uploadEta } from '@/lib/backup-view';
import { formatSize } from '@/lib/format-size';

type Uploaded = { name: string; manifest: { createdAt: string; environment: string; appVersion: string } };
type Phase = { kind: 'pick'; refused: string | null } | { kind: 'sending'; done: number; total: number; startedAt: number } | { kind: 'done'; uploaded: Uploaded };

const ENVIRONMENTS = new Set(['development', 'test', 'production']);

/**
 * Datei hochladen (Designer 3b): Die Wahl startet sofort die Übertragung an den Upload-Route-Handler, mit Fortschritt
 * und Restzeit — das zeigt kein Browser. „Abbrechen“ bricht die Übertragung ab (keine Zeile, kein Neuladen). Danach
 * steht die Datei geprüft als „hochgeladen“ in der Liste; der Dialog sagt das mit Haken, „Schließen“ und „Einspielen …“
 * (outline) öffnet den Dialog dafür. Eine Ablehnung steht im Dialog.
 */
export function UploadDialog({ onClose, onRestore, xhr: makeXhr = () => new XMLHttpRequest() }: { onClose(): void; onRestore(name: string): void; xhr?: () => XMLHttpRequest }) {
  const t = useTranslations('backup');
  const c = useTranslations('common');
  const fmt = useDateFormat();
  const router = useRouter();
  const request = useRef<XMLHttpRequest | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'pick', refused: null });
  const [now, setNow] = useState(() => Date.now());

  // Die Restzeit rechnet aus der bisherigen Rate; einmal je Sekunde neu, auch wenn gerade kein Fortschritt kommt.
  useEffect(() => {
    if (phase.kind !== 'sending') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase.kind]);

  const send = (file: File | null) => {
    if (!file) return;
    const xhr = makeXhr();
    request.current = xhr;
    const startedAt = Date.now();
    setPhase({ kind: 'sending', done: 0, total: file.size, startedAt });
    xhr.upload.onprogress = (e) => {
      setNow(Date.now());
      setPhase({ kind: 'sending', done: e.loaded, total: e.lengthComputable ? e.total : file.size, startedAt });
    };
    const refuse = (reason: string) => setPhase({ kind: 'pick', refused: t('upload.refused', { reason }) });
    xhr.onload = () => {
      request.current = null;
      let body: Partial<Uploaded> & { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText || '{}') as typeof body;
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.name && body.manifest) {
        setPhase({ kind: 'done', uploaded: { name: body.name, manifest: body.manifest } });
        router.refresh();
        return;
      }
      refuse(body.error ?? 'unknown');
    };
    xhr.onerror = () => {
      request.current = null;
      refuse('unknown');
    };
    xhr.open('POST', '/admin/backup/upload');
    xhr.send(file);
  };

  const cancel = () => {
    request.current?.abort();
    request.current = null;
    onClose();
  };

  const eta = phase.kind === 'sending' ? uploadEta(phase.done, phase.total, now - phase.startedAt) : null;
  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent size="sm">
        <div className="flex flex-col gap-4">
          <DialogTitle>{t('upload.title')}</DialogTitle>
          {phase.kind === 'done' ? null : <DialogDescription>{t('upload.text')}</DialogDescription>}
          {phase.kind === 'pick' ? (
            <>
              {phase.refused ? <RefusalNotice state={{ status: 'error', message: phase.refused, fieldErrors: {} }} /> : null}
              <FormField id="backup-upload-file" label={t('upload.file')}>
                <FileDropzone id="backup-upload-file" name="archive" accept=".tar,application/x-tar" hint={t('upload.fileHint')} onFile={send} />
              </FormField>
            </>
          ) : null}
          {phase.kind === 'sending' ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <Progress value={phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : 0} aria-label={t('upload.file')} />
              <p className="flex flex-wrap justify-between gap-2 text-meta text-ink-2 tabular-nums">
                <span>{t('upload.progress', { done: formatSize(phase.done), total: formatSize(phase.total) })}</span>
                {eta !== null ? <span>{t('upload.eta', { minutes: eta })}</span> : null}
              </p>
              <p className="text-hint text-muted-ink">{t('upload.keepOpen')}</p>
            </div>
          ) : null}
          {phase.kind === 'done' ? (
            <p className="flex items-start gap-2 text-body text-ink-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>
                {t('upload.done', {
                  when: fmt.dateTime(phase.uploaded.manifest.createdAt),
                  env: ENVIRONMENTS.has(phase.uploaded.manifest.environment) ? t(`environments.${phase.uploaded.manifest.environment}`) : phase.uploaded.manifest.environment,
                  version: phase.uploaded.manifest.appVersion,
                })}
              </span>
            </p>
          ) : null}
          {phase.kind === 'done' ? (
            // Dialog ohne Hauptaktion (MUSTER § B, Designer 3b): Das Hochladen ist fertig, nichts mehr abzubrechen.
            // Einspielen ist ein eigener Schritt mit eigenem Dialog, deshalb `outline`, nicht primär.
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {c('close')}
              </Button>
              <Button variant="outline" onClick={() => onRestore(phase.uploaded.name)}>
                {t('upload.restore')}
              </Button>
            </DialogFooter>
          ) : (
            // Dialog ohne Hauptaktion: nur „Abbrechen“, das auch die Übertragung abbricht (MUSTER § B).
            <DialogFooter>
              <Button variant="ghost" onClick={cancel}>
                {c('cancel')}
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
