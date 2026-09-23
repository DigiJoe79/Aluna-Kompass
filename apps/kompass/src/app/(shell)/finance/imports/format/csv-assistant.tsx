'use client';

import { readCsv } from '@kompass/module-finance/csv';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { formatEuro, parseAmount } from '@/lib/finance/amount';
import {
  assistantFileKey,
  buildFormat,
  canAdvance,
  COLUMN_ROLES,
  initialState,
  loadState,
  previewRecords,
  saveState,
  signQuestionLine,
  storageKey,
  type AssistantState,
  type AssistantStep,
} from '@/lib/finance/csv-assistant-state';
import { cn } from '@/lib/utils';
import { saveCsvFormatAction } from './actions';

export interface AssistantAccount {
  id: string;
  name: string;
  importFormat: 'camt053' | 'csv' | null;
  /** Kopfzeilen-Signatur des aktiven CSV-Formats — entscheidet, ob Speichern ein Wechsel ist. */
  headerSignature: string | null;
}

interface LoadedFile {
  name: string;
  bytes: Uint8Array;
  key: string;
}

const STEPS: AssistantStep[] = [1, 2, 3, 4, 5];
const ENCODINGS = ['utf-8', 'windows-1252', 'iso-8859-1'] as const;
const DELIMITERS = [';', ',', '\t', '|'] as const;
const DATE_FORMATS = ['DD.MM.YYYY', 'DD.MM.YY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;
const DATE_FORMAT_KEYS: Record<(typeof DATE_FORMATS)[number], string> = { 'DD.MM.YYYY': 'dots', 'DD.MM.YY': 'dotsShort', 'YYYY-MM-DD': 'iso', 'DD/MM/YYYY': 'slashDayFirst', 'MM/DD/YYYY': 'slashMonthFirst' };

/** `localStorage` kann schon beim Zugriff werfen (privates Fenster, gesperrte Website-Daten). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isoToGerman = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Der CSV-Assistent (F4b Task 5, HANDOFF § 12.3): fünf Schritte, nichts
 * klappt auf. Die Vorschau rechnet der reine CSV-Kern im Browser; der Stand
 * wird je Konto und Datei laufend gesichert — ohne die Bytes und ohne
 * `crypto.subtle`, das es über Klartext-HTTP nicht gibt.
 */
export function CsvAssistant({ accounts, initialAccountId, canLoad }: { accounts: AssistantAccount[]; initialAccountId: string; canLoad: boolean }) {
  const t = useTranslations('finance.csvAssistant');
  const router = useRouter();
  const [accountId, setAccountId] = useState(initialAccountId);
  const [csvChosen, setCsvChosen] = useState(false);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [state, setState] = useState<AssistantState | null>(null);
  const [balanceText, setBalanceText] = useState('');
  const [pendingLoad, setPendingLoad] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const step: AssistantStep = state?.step ?? 1;

  useEffect(() => {
    if (file && state && account) saveState(browserStorage(), storageKey(account.id, file.key), state);
  }, [file, state, account]);

  const preview = useMemo(() => (file && state ? previewRecords(file.bytes, state.settings) : { header: [], rows: [] }), [file, state]);
  const built = useMemo(() => (state ? buildFormat(preview.header, state) : null), [preview.header, state]);
  const signLine = useMemo(() => (file && built?.ok ? signQuestionLine(file.bytes, built.format) : null), [file, built]);
  const read = useMemo(() => (file && built?.ok && state?.invertSign !== null ? readCsv(file.bytes, built.format) : null), [file, built, state?.invertSign]);

  const update = (patch: Partial<AssistantState>) => setState((s) => (s ? { ...s, ...patch } : s));
  const goTo = (next: AssistantStep) => {
    setError(null);
    update({ step: next });
  };

  const chooseFile = async (chosen: File) => {
    if (!account) return;
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    const key = assistantFileKey(chosen.name, bytes);
    setFile({ name: chosen.name, bytes, key });
    setState(loadState(browserStorage(), storageKey(account.id, key)) ?? initialState(bytes, t('defaultName', { account: account.name })));
  };

  const needsSwitch = (): boolean => {
    if (!account || !built?.ok) return false;
    return account.importFormat === 'camt053' || (account.headerSignature !== null && account.headerSignature !== built.format.headerSignature);
  };

  const save = async (load: boolean, confirmFormatChange: boolean): Promise<ActionState> => {
    if (!account || !file || !state || !built?.ok) return { status: 'error', message: '', fieldErrors: {} };
    setBusy(true);
    setError(null);
    const closingBalanceCents = balanceText.trim() !== '' ? (parseAmount(balanceText) ?? undefined) : undefined;
    const result = await saveCsvFormatAction({
      accountId: account.id,
      name: state.name.trim(),
      format: { ...built.format, invertSign: state.invertSign ?? false },
      confirmFormatChange,
      load: load ? { fileName: file.name, bytes: file.bytes, closingBalanceCents } : null,
    });
    setBusy(false);
    if (result.status === 'success') {
      try {
        browserStorage()?.removeItem(storageKey(account.id, file.key));
      } catch {
        // ohne Speicher gibt es nichts aufzuräumen
      }
      router.push('/finance/imports');
    } else {
      setError(result.status === 'error' ? (result.detail ?? result.message) : null);
    }
    return result;
  };

  const requestSave = (load: boolean) => {
    // Über den Wechsel-Dialog meldet `ConfirmDialog` das Ergebnis selbst; ohne Dialog tun wir es hier.
    if (needsSwitch()) setPendingLoad(load);
    else
      void save(load, false).then((result) => {
        if (result.status === 'success' && result.message) toast.success(result.message);
      });
  };

  const probeLines = read?.ok ? read.statement.lines : [];
  const first = probeLines[0] ?? null;
  const fee = first && probeLines[1] && probeLines[1].bookingDate === first.bookingDate && probeLines[1].purpose.startsWith('Gebühr') ? probeLines[1] : null;
  const hasBalanceColumn = built?.ok ? built.format.columns.balance !== null : false;

  return (
    <div className="space-y-6">
      <ol aria-label={t('stepsLabel')} className="flex flex-wrap gap-2 text-[13px]">
        {STEPS.map((s) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1', s === step ? 'border-primary bg-brand-soft font-semibold text-ink' : 'border-line text-muted-ink')}
          >
            {s < step ? <Check className="size-3.5" aria-hidden /> : <span className="font-mono">{s}</span>}
            {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="max-w-[760px] space-y-4">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="csv-account">{t('accountLabel')}</Label>
            <Select id="csv-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2 rounded-md border border-line bg-surface p-4">
            <h2 className="font-heading text-[18px]">{t('camt.title')}</h2>
            <p className="text-[14px] text-ink-2">{t('camt.text')}</p>
            <Link href="/help/finanzen/auszug-bei-der-bank-holen" className="text-link text-[14px]">
              {t('camt.link')}
            </Link>
          </div>
          {!csvChosen ? (
            <Button type="button" variant="secondary" onClick={() => setCsvChosen(true)}>
              {t('camt.csvAnyway')}
            </Button>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="csv-file">{t('fileLabel')}</Label>
              <input
                id="csv-file"
                data-testid="csv-file-input"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="block text-[13px]"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen) void chooseFile(chosen);
                  e.target.value = '';
                }}
              />
            </div>
          )}
        </section>
      ) : null}

      {state && step === 2 ? (
        <section className="max-w-[760px] space-y-4">
          <h2 className="font-heading text-[18px]">{t('settings.title')}</h2>
          <p className="text-[14px] text-ink-2">{t('settings.text')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="csv-encoding">{t('settings.encoding')}</Label>
              <Select id="csv-encoding" value={state.settings.encoding} onChange={(e) => update({ settings: { ...state.settings, encoding: e.target.value as AssistantState['settings']['encoding'] } })}>
                {ENCODINGS.map((v) => (
                  <option key={v} value={v}>
                    {t(`settings.encodings.${v}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="csv-delimiter">{t('settings.delimiter')}</Label>
              <Select id="csv-delimiter" value={state.settings.delimiter} onChange={(e) => update({ settings: { ...state.settings, delimiter: e.target.value as AssistantState['settings']['delimiter'] } })}>
                {DELIMITERS.map((v) => (
                  <option key={v} value={v}>
                    {t(`settings.delimiters.${v === '\t' ? 'tab' : v === ';' ? 'semicolon' : v === ',' ? 'comma' : 'pipe'}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="csv-header-row">{t('settings.headerRow')}</Label>
              <Input id="csv-header-row" type="number" min={1} max={31} value={state.settings.headerRow + 1} onChange={(e) => update({ settings: { ...state.settings, headerRow: Math.max(0, Math.min(30, Number(e.target.value) - 1)) } })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="csv-date-format">{t('settings.dateFormat')}</Label>
              <Select id="csv-date-format" value={state.settings.dateFormat ?? ''} onChange={(e) => update({ settings: { ...state.settings, dateFormat: (e.target.value || null) as AssistantState['settings']['dateFormat'] } })}>
                <option value="">{t('settings.choose')}</option>
                {DATE_FORMATS.map((v) => (
                  <option key={v} value={v}>
                    {t(`settings.dateFormats.${DATE_FORMAT_KEYS[v]}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="csv-decimal">{t('settings.decimal')}</Label>
              <Select id="csv-decimal" value={state.settings.decimalSeparator ?? ''} onChange={(e) => update({ settings: { ...state.settings, decimalSeparator: (e.target.value || null) as ',' | '.' | null } })}>
                <option value="">{t('settings.choose')}</option>
                <option value=",">{t('settings.decimals.comma')}</option>
                <option value=".">{t('settings.decimals.dot')}</option>
              </Select>
            </div>
          </div>
        </section>
      ) : null}

      {state && step === 3 ? (
        <section className="space-y-3">
          <h2 className="font-heading text-[18px]">{t('columns.title')}</h2>
          <p className="max-w-[760px] text-[14px] text-ink-2">{t('columns.text')}</p>
          <div className="overflow-x-auto rounded-md border border-line">
            <table data-testid="csv-preview" className="w-full text-[13px]">
              <thead>
                <tr>
                  {preview.header.map((column, i) => {
                    const ignored = (state.roles[i] ?? 'ignore') === 'ignore';
                    return (
                      <th key={i} data-column={column} data-ignored={ignored ? 'true' : 'false'} className={cn('space-y-1 border-b border-line bg-surface-2 p-2 text-left align-top', ignored && 'border-dashed text-muted-ink')}>
                        <Select
                          aria-label={t('columns.roleLabel', { column })}
                          value={state.roles[i] ?? 'ignore'}
                          onChange={(e) => update({ roles: preview.header.map((_, j) => (j === i ? (e.target.value as AssistantState['roles'][number]) : (state.roles[j] ?? 'ignore'))) })}
                        >
                          {COLUMN_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {t(`columns.roles.${role}`)}
                            </option>
                          ))}
                        </Select>
                        <p className="font-semibold">{column}</p>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, r) => (
                  <tr key={r} className="border-b border-line-2 last:border-0">
                    {preview.header.map((column, i) => {
                      const ignored = (state.roles[i] ?? 'ignore') === 'ignore';
                      return (
                        <td key={i} data-column={column} data-ignored={ignored ? 'true' : 'false'} className={cn('p-2 font-mono', ignored && 'border-x border-dashed border-line text-muted-ink opacity-60')}>
                          {row[i] ?? ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.roles.includes('indicator') ? (
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="csv-indicator-values">{t('columns.indicatorValues')}</Label>
              <Input id="csv-indicator-values" value={state.indicatorValues} onChange={(e) => update({ indicatorValues: e.target.value })} />
            </div>
          ) : null}
          {state.roles.includes('pending') ? (
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="csv-pending-values">{t('columns.pendingValues')}</Label>
              <Input id="csv-pending-values" value={state.pendingValues} onChange={(e) => update({ pendingValues: e.target.value })} />
            </div>
          ) : null}
          {built && !built.ok ? <p className="text-[13px] text-error">{t(`columns.reasons.${built.reason}`)}</p> : null}
        </section>
      ) : null}

      {state && step === 4 ? (
        <section className="max-w-[760px] space-y-4">
          <h2 className="font-heading text-[18px]">{t('sign.title')}</h2>
          {signLine ? (
            <>
              <p className="text-[15px]">{t('sign.question', { amount: formatEuro(Math.abs(signLine.amountCents)), who: signLine.counterpartyName ?? signLine.purpose })}</p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" size="lg" variant={state.invertSign === (signLine.amountCents > 0) ? 'default' : 'secondary'} onClick={() => update({ invertSign: signLine.amountCents > 0 })}>
                  {t('sign.yes')}
                </Button>
                <Button type="button" size="lg" variant={state.invertSign === (signLine.amountCents < 0) ? 'default' : 'secondary'} onClick={() => update({ invertSign: signLine.amountCents < 0 })}>
                  {t('sign.no')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-[14px] text-ink-2">{t('sign.noLine')}</p>
          )}
        </section>
      ) : null}

      {state && step === 5 ? (
        <section className="max-w-[760px] space-y-4">
          <h2 className="font-heading text-[18px]">{t('probe.title')}</h2>
          {read && !read.ok ? (
            <Notice level="refuse" title={t('probe.unreadable')}>
              {t(`probe.errors.${read.error.code}`, { line: read.error.line ?? '' })}
            </Notice>
          ) : null}
          {first ? (
            <dl data-testid="csv-probe" className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-md border border-line bg-surface p-4 text-[14px]">
              <dt className="text-muted-ink">{t('probe.date')}</dt>
              <dd className="font-mono">{isoToGerman(first.bookingDate)}</dd>
              <dt className="text-muted-ink">{t('probe.counterparty')}</dt>
              <dd>{first.counterpartyName ?? '—'}</dd>
              <dt className="text-muted-ink">{t('probe.iban')}</dt>
              <dd className="font-mono">{first.counterpartyIban ?? '—'}</dd>
              <dt className="text-muted-ink">{t('probe.purpose')}</dt>
              <dd>{first.purpose || '—'}</dd>
              <dt className="text-muted-ink">{t('probe.amount')}</dt>
              <dd className="font-mono tabular-nums">{formatEuro(first.amountCents)}</dd>
              {fee ? (
                <>
                  <dt className="text-muted-ink">{t('probe.fee')}</dt>
                  <dd className="font-mono tabular-nums">{formatEuro(fee.amountCents)}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="csv-name">{t('probe.nameLabel')}</Label>
            <Input id="csv-name" value={state.name} onChange={(e) => update({ name: e.target.value })} />
          </div>
          {!hasBalanceColumn && read?.ok ? (
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="csv-balance">{t('probe.balanceLabel', { date: isoToGerman(read.statement.to) })}</Label>
              <Input id="csv-balance" inputMode="decimal" value={balanceText} onChange={(e) => setBalanceText(e.target.value)} />
            </div>
          ) : null}
          {error ? <Notice level="refuse">{error}</Notice> : null}
          <div className="flex flex-wrap gap-3">
            {canLoad ? (
              <Button type="button" disabled={busy || !read?.ok || !canAdvance(5, state, preview.header)} onClick={() => requestSave(true)}>
                {t('probe.saveAndLoad')}
              </Button>
            ) : null}
            <Button type="button" variant={canLoad ? 'secondary' : 'default'} disabled={busy || !read?.ok || !canAdvance(5, state, preview.header)} onClick={() => requestSave(false)}>
              {t('probe.saveOnly')}
            </Button>
          </div>
        </section>
      ) : null}

      {state && step > 1 ? (
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={() => (step === 2 ? (setState(null), setFile(null)) : goTo((step - 1) as AssistantStep))}>
            {t('back')}
          </Button>
          {step < 5 ? (
            <Button type="button" disabled={!canAdvance(step, state, preview.header)} onClick={() => goTo((step + 1) as AssistantStep)}>
              {t('next')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingLoad !== null}
        onOpenChange={(open) => !open && setPendingLoad(null)}
        title={t('switchDialog.title')}
        description={t('switchDialog.description')}
        confirmLabel={t('switchDialog.confirm')}
        action={() => save(pendingLoad ?? false, true)}
      />
    </div>
  );
}
