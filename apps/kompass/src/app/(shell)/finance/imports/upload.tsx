'use client';

import type { DetectedStatement } from '@kompass/module-finance';
import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Notice } from '@/components/notice';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import type { ActionState } from '@/lib/actions';
import { stashCsvHandoff } from '@/lib/finance/csv-handoff';
import { groupIban } from '@/lib/finance/iban-check';
import { remediesFor } from '@/lib/finance/remedies';
import { cn } from '@/lib/utils';
import { detectStatementAccountAction, uploadStatementAction } from './actions';

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
  /** Das Konto, auf das geladen wurde — für den Formatwechsel und den Weg in den Assistenten. */
  accountId?: string;
  file: File;
}

type Doubt = Extract<DetectedStatement, { kind: 'many' } | { kind: 'none' }>;

/** Ein Zwischenschritt wartet auf den Menschen; `resolve` gibt das gewählte Konto zurück, oder `null` für „nicht laden“. */
interface PendingDoubt {
  file: File;
  bytes: Uint8Array;
  doubt: Doubt;
  resolve: (accountId: string | null) => void;
}

/** `sessionStorage` kann schon beim Zugriff werfen (privates Fenster, gesperrte Website-Daten). */
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const newKey = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Die Ablagefläche „Kontoauszug hierher ziehen“ (F4 Task 7, HANDOFF § 12.4;
 * N3, W-1). Kein Konto vorher wählen: Je Datei erkennt Kompass das Konto
 * (`detectStatementAccountAction`) — passt genau eins, wird ohne Rückfrage
 * geladen. Nur bei keinem oder mehreren Treffern fragt ein Zwischenschritt
 * nach. Mehrere Dateien laufen **nacheinander**, jede mit eigenem Ergebnis in
 * einer `aria-live`-Region. Ein Formatwechsel öffnet einen
 * Bestätigungsdialog (Entschieden 1) und lädt erst danach dieselbe Datei
 * erneut, mit `confirmFormatChange: true`.
 */
export function ImportUpload({ accounts }: { accounts: ImportAccountOption[] }) {
  const t = useTranslations('finance.imports.upload');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const { date } = useDateFormat();
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [formatChangeTarget, setFormatChangeTarget] = useState<UploadResult | null>(null);
  const [pending, setPending] = useState<PendingDoubt | null>(null);
  const [chosen, setChosen] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  /** Nach „Format für ein Konto einrichten“ verlässt die Seite den Stapel — die übrigen Dateien laufen nicht mehr. */
  const stoppedRef = useRef(false);

  const accountName = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? '';

  const runOne = async (file: File, bytes: Uint8Array, accountId: string, confirmFormatChange?: boolean): Promise<UploadResult> => {
    const res = await uploadStatementAction(accountId, file.name, bytes, confirmFormatChange);
    const key = newKey(file.name);
    if (res.status === 'success') {
      const runs = (res.data as { runs: { counts: { new: number; known: number; held: number } }[] } | undefined)?.runs ?? [];
      const summary = runs.reduce((sum, r) => ({ new: sum.new + r.counts.new, known: sum.known + r.counts.known, held: sum.held + r.counts.held }), { new: 0, known: 0, held: 0 });
      return { key, fileName: file.name, status: 'success', summary, accountId, file };
    }
    return { key, fileName: file.name, status: 'error', message: res.status === 'error' ? (res.detail ?? res.message) : undefined, code: res.status === 'error' ? res.code : undefined, accountId, file };
  };

  const ask = (file: File, bytes: Uint8Array, doubt: Doubt) =>
    new Promise<string | null>((resolve) => {
      setChosen('');
      setPending({ file, bytes, doubt, resolve });
    });

  const answer = (accountId: string | null) => {
    pending?.resolve(accountId);
    setPending(null);
  };

  /** Welches Konto? `null`: nicht laden (abgelehnt, abgebrochen oder zum Einrichten weitergeleitet). */
  const accountFor = async (file: File, bytes: Uint8Array): Promise<string | null> => {
    const res = await detectStatementAccountAction(file.name, bytes);
    if (res.status === 'error') {
      setResults((prev) => [...prev, { key: newKey(file.name), fileName: file.name, status: 'error', message: res.detail ?? res.message, code: res.code, file }]);
      return null;
    }
    if (res.status !== 'success') return null;
    const detected = res.data as DetectedStatement;
    if (detected.kind === 'one') return detected.accountId;
    if (detected.kind === 'unreadable') {
      setResults((prev) => [...prev, { key: newKey(file.name), fileName: file.name, status: 'error', message: t('unreadable'), file }]);
      return null;
    }
    return ask(file, bytes, detected);
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    stoppedRef.current = false;
    for (const file of files) {
      if (stoppedRef.current) break;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const accountId = await accountFor(file, bytes);
      if (!accountId) continue;
      const outcome = await runOne(file, bytes, accountId);
      setResults((prev) => [...prev, outcome]);
      router.refresh();
    }
    setBusy(false);
  };

  /** „Format für ein Konto einrichten“: die Datei geht mit in den Assistenten; scheitert das, wählt man sie dort erneut. */
  const openAssistantWith = (target: PendingDoubt) => {
    const carried = stashCsvHandoff(sessionStore(), { name: target.file.name, bytes: target.bytes });
    stoppedRef.current = true;
    answer(null);
    router.push(carried ? '/finance/imports/format' : '/finance/imports/format?reselect=1');
  };

  /**
   * Der Formatwechsel-Ausweg (Entschieden 1, F4): kein sofortiger Retry aus
   * der Meldung heraus, sondern ein eigener Bestätigungsdialog, der den
   * Hinweis auf mehr Zweifelsfälle noch einmal ausdrücklich nennt.
   */
  const confirmFormatChangeAndRetry = async (): Promise<ActionState> => {
    const target = formatChangeTarget!;
    setBusy(true);
    const outcome = await runOne(target.file, new Uint8Array(await target.file.arrayBuffer()), target.accountId!, true);
    setResults((prev) => prev.map((r) => (r.key === target.key ? outcome : r)));
    router.refresh();
    setBusy(false);
    return outcome.status === 'success' ? { status: 'success' } : { status: 'error', message: outcome.message ?? '', fieldErrors: {} };
  };

  const doubt = pending?.doubt ?? null;

  return (
    <section className="space-y-3">
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
              remedies={remediesFor(r.code ?? '')
                // Eine Kontoauswahl gibt es hier nicht mehr (W-1) — „Anderes Konto wählen“ bleibt der Ausweg über MCP.
                .filter((remedy) => !(remedy.kind === 'action' && remedy.action === 'focusAccount'))
                .map((remedy) => ({
                  label: tRoot(remedy.labelKey),
                  ...(remedy.kind === 'action'
                    ? {
                        onSelect: () => {
                          if (remedy.action === 'confirmFormatChange') setFormatChangeTarget(r);
                          else if (remedy.action === 'openCsvAssistant') router.push(`/finance/imports/format?account=${encodeURIComponent(r.accountId ?? '')}`);
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

      <Dialog open={pending !== null} onOpenChange={(open) => !open && answer(null)}>
        <DialogContent className="bg-surface shadow-md sm:max-w-md">
          {pending && doubt?.kind === 'many' ? (
            <>
              <DialogTitle className="font-heading text-[19px]">{t('choose.title')}</DialogTitle>
              <p className="text-[14px] text-ink-2">
                {t(doubt.format === 'csv' ? 'choose.questionCsv' : 'choose.questionCamt', { file: pending.file.name, count: doubt.accounts.length })}
              </p>
              <div role="radiogroup" aria-label={t('choose.accountsLabel')} className="space-y-2">
                {doubt.accounts.map((a) => (
                  <label key={a.accountId} className={cn('flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-[13px]', chosen === a.accountId ? 'border-primary bg-brand-soft' : 'border-line')}>
                    <input type="radio" name="statement-account" value={a.accountId} checked={chosen === a.accountId} onChange={() => setChosen(a.accountId)} className="mt-0.5 size-4" />
                    <span>
                      <span className="block font-semibold text-ink">{a.name}</span>
                      <span className="block text-ink-2">
                        {a.importedThrough ? t('choose.formatThrough', { format: a.formatLabel, date: date(a.importedThrough) }) : t('choose.formatNothingYet', { format: a.formatLabel })}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => answer(null)}>
                  {tCommon('cancel')}
                </Button>
                <Button type="button" disabled={chosen === ''} onClick={() => answer(chosen)}>
                  {t('choose.submit')}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {pending && doubt?.kind === 'none' && doubt.format === 'csv' ? (
            <>
              <DialogTitle className="font-heading text-[19px]">{t('noneCsv.title')}</DialogTitle>
              <p className="text-[14px] text-ink-2">{t('noneCsv.text', { file: pending.file.name })}</p>
              <p className="text-[14px] text-ink-2">{t('noneCsv.question')}</p>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => answer(null)}>
                  {tCommon('cancel')}
                </Button>
                <Button type="button" title={t('noneCsv.setUpHint')} onClick={() => openAssistantWith(pending)}>
                  {t('noneCsv.setUp')}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {pending && doubt?.kind === 'none' && doubt.format === 'camt053' ? (
            <>
              <DialogTitle className="font-heading text-[19px]">{t('noneCamt.title')}</DialogTitle>
              <p className="text-[14px] text-ink-2">{t('noneCamt.text', { file: pending.file.name, iban: groupIban(doubt.iban ?? '') })}</p>
              <p className="text-[14px] text-ink-2">{t('noneCamt.hint')}</p>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => answer(null)}>
                  {tCommon('cancel')}
                </Button>
                <Link
                  href="/admin/finance?panel=accounts"
                  className={buttonVariants()}
                  onClick={() => {
                    stoppedRef.current = true;
                    answer(null);
                  }}
                >
                  {t('noneCamt.setUp')}
                </Link>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={formatChangeTarget !== null}
        onOpenChange={(open) => !open && setFormatChangeTarget(null)}
        title={t('formatChangeDialog.title')}
        description={t('formatChangeDialog.description', { account: accountName(formatChangeTarget?.accountId) })}
        confirmLabel={t('formatChangeDialog.confirm')}
        action={confirmFormatChangeAndRetry}
      />
    </section>
  );
}
