'use client';

import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Notice } from '@/components/notice';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { remediesFor } from '@/lib/finance/remedies';
import { cn } from '@/lib/utils';
import { uploadStatementAction } from './actions';

export interface ImportAccountOption {
  id: string;
  name: string;
}

interface UploadResult {
  key: string;
  fileName: string;
  status: 'success' | 'error';
  summary?: { new: number; known: number; held: number };
  message?: string;
  code?: string;
  file: File;
}

/**
 * Die Ablagefläche „Kontoauszug hierher ziehen“ (F4 Task 7, HANDOFF § 12.4).
 * Mehrere Dateien laufen **nacheinander**, jede mit eigenem Ergebnis; das
 * Ergebnis steht in einer `aria-live`-Region. Ein Formatwechsel öffnet einen
 * Bestätigungsdialog mit dem Hinweis auf mehr Zweifelsfälle (Entschieden 1)
 * und lädt erst nach Bestätigung dieselbe Datei erneut, mit
 * `confirmFormatChange: true`.
 */
export function ImportUpload({ accounts, defaultAccountId }: { accounts: ImportAccountOption[]; defaultAccountId?: string }) {
  const t = useTranslations('finance.imports.upload');
  const tRoot = useTranslations();
  const router = useRouter();
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? '');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [formatChangeTarget, setFormatChangeTarget] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);

  const runOne = async (file: File, confirmFormatChange?: boolean): Promise<UploadResult> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await uploadStatementAction(accountId, file.name, bytes, confirmFormatChange);
    const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (res.status === 'success') {
      const runs = (res.data as { runs: { counts: { new: number; known: number; held: number } }[] } | undefined)?.runs ?? [];
      const summary = runs.reduce((sum, r) => ({ new: sum.new + r.counts.new, known: sum.known + r.counts.known, held: sum.held + r.counts.held }), { new: 0, known: 0, held: 0 });
      return { key, fileName: file.name, status: 'success', summary, file };
    }
    return { key, fileName: file.name, status: 'error', message: res.status === 'error' ? (res.detail ?? res.message) : undefined, code: res.status === 'error' ? res.code : undefined, file };
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0 || !accountId) return;
    setBusy(true);
    for (const file of files) {
      const outcome = await runOne(file);
      setResults((prev) => [...prev, outcome]);
      router.refresh();
    }
    setBusy(false);
  };

  /**
   * Der Formatwechsel-Ausweg (Entschieden 1, F4): kein sofortiger Retry aus
   * der Meldung heraus, sondern ein eigener Bestätigungsdialog, der den
   * Hinweis auf mehr Zweifelsfälle noch einmal ausdrücklich nennt.
   */
  const confirmFormatChangeAndRetry = async (): Promise<ActionState> => {
    const target = formatChangeTarget!;
    setBusy(true);
    const outcome = await runOne(target.file, true);
    setResults((prev) => prev.map((r) => (r.key === target.key ? outcome : r)));
    router.refresh();
    setBusy(false);
    return outcome.status === 'success' ? { status: 'success' } : { status: 'error', message: outcome.message ?? '', fieldErrors: {} };
  };

  return (
    <section className="space-y-3">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="import-account">{t('accountLabel')}</Label>
        <Select id="import-account" ref={accountRef} value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={busy}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>

      <div
        role="presentation"
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) void processFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          'flex h-24 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-center text-[13px]',
          dragging ? 'border-primary bg-brand-soft' : 'border-line-strong bg-surface',
        )}
      >
        <FileUp className="size-5 text-muted-ink" aria-hidden />
        {dragging ? (
          <p className="font-semibold text-ink">{t('dropHere')}</p>
        ) : (
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="font-semibold text-ink underline underline-offset-2">
            {t('dragOrPick')}
          </button>
        )}
        <input
          ref={inputRef}
          data-testid="statement-file-input"
          type="file"
          accept=".xml,text/xml,application/xml,.csv,text/csv,.txt,text/plain"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files) void processFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
      </div>

      <div data-testid="import-upload-results" aria-live="polite" className="space-y-2">
        {results.map((r) =>
          r.status === 'success' ? (
            <p key={r.key} className="text-[13px] text-ink-2">
              <span className="font-semibold text-ink">{r.fileName}: </span>
              {t('result', { new: r.summary!.new, known: r.summary!.known, held: r.summary!.held })}
            </p>
          ) : (
            <Notice
              key={r.key}
              level="refuse"
              title={r.fileName}
              remedies={remediesFor(r.code ?? '').map((remedy) => ({
                label: tRoot(remedy.labelKey),
                ...(remedy.kind === 'action'
                  ? {
                      onSelect: () => {
                        if (remedy.action === 'focusAccount') accountRef.current?.focus();
                        else if (remedy.action === 'confirmFormatChange') setFormatChangeTarget(r);
                        else if (remedy.action === 'openCsvAssistant') router.push(`/finance/imports/format?account=${encodeURIComponent(accountId)}`);
                      },
                    }
                  : { href: remedy.href }),
              }))}
            >
              {r.message}
            </Notice>
          ),
        )}
      </div>

      <ConfirmDialog
        open={formatChangeTarget !== null}
        onOpenChange={(open) => !open && setFormatChangeTarget(null)}
        title={t('formatChangeDialog.title')}
        description={t('formatChangeDialog.description', { account: accounts.find((a) => a.id === accountId)?.name ?? '' })}
        confirmLabel={t('formatChangeDialog.confirm')}
        action={confirmFormatChangeAndRetry}
      />
    </section>
  );
}
