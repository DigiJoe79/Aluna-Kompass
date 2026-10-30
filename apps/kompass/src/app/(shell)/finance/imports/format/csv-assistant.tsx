'use client';

import { readCsv } from '@kompass/module-finance/csv';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ChoiceCards } from '@/components/choice-cards';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { Steps, stepsFrom } from '@/components/steps';
import { FormGrid } from '@/components/forms/form-grid';
import { FileDropzone } from '@/app/(shell)/dms/receive/file-dropzone';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { formatEuro, readAmount } from '@/lib/finance/amount';
import { takeCsvHandoff, type CsvHandoff } from '@/lib/finance/csv-handoff';
import {
  assistantFileKey,
  buildFormat,
  canAdvance,
  defaultFormatName,
  initialState,
  loadState,
  previewRecords,
  saveState,
  signQuestionLine,
  storageKey,
  type AssistantState,
  type AssistantStep,
} from '@/lib/finance/csv-assistant-state';
import { saveCsvFormatAction } from './actions';
import { columnsNote, ColumnsStep } from './columns-step';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';
import { formatIban } from '@kompass/module-finance/format';

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

/** Wie `browserStorage`, für die Datei aus der Ablagefläche (N3, W-1) — sie überlebt nur den Wechsel in den Assistenten. */
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Der CSV-Assistent (F4b Task 5, HANDOFF § 12.3): fünf Schritte, nichts
 * klappt auf. Die Vorschau rechnet der reine CSV-Kern im Browser; der Stand
 * wird je Konto und Datei laufend gesichert — ohne die Bytes und ohne
 * `crypto.subtle`, das es über Klartext-HTTP nicht gibt.
 */
export function CsvAssistant({ accounts, initialAccountId, canLoad, reselect = false }: { accounts: AssistantAccount[]; initialAccountId: string; canLoad: boolean; reselect?: boolean }) {
  const t = useTranslations('finance.csvAssistant');
  const tCommon = useTranslations('common');
  const tColumns = useTranslations('finance.csvAssistant.columns');
  const { date } = useDateFormat();
  const router = useRouter();
  /** Die Datei aus dem Zwischenschritt der Ablagefläche (N3, W-1): Konto wählen, dann mit ihr weiter. */
  const [handoff, setHandoff] = useState<CsvHandoff | null>(null);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [csvChosen, setCsvChosen] = useState(false);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [state, setState] = useState<AssistantState | null>(null);
  const [balanceText, setBalanceText] = useState('');
  const [balanceInvalid, setBalanceInvalid] = useState(false);
  const tAmount = useTranslations('finance.amount');
  const [pendingLoad, setPendingLoad] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const step: AssistantStep = state?.step ?? 1;

  useEffect(() => {
    const carried = takeCsvHandoff(sessionStore());
    if (carried) {
      setHandoff(carried);
      setCsvChosen(true);
    } else if (reselect) setCsvChosen(true);
  }, [reselect]);

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

  const openBytes = (name: string, bytes: Uint8Array) => {
    if (!account) return;
    const key = assistantFileKey(name, bytes);
    setFile({ name, bytes, key });
    setState(loadState(browserStorage(), storageKey(account.id, key)) ?? initialState(bytes, defaultFormatName(account.name, (name) => t('defaultName', { account: name }))));
  };

  const chooseFile = async (chosen: File) => {
    setHandoff(null);
    openBytes(chosen.name, new Uint8Array(await chosen.arrayBuffer()));
  };

  const needsSwitch = (): boolean => {
    if (!account || !built?.ok) return false;
    return account.importFormat === 'camt053' || (account.headerSignature !== null && account.headerSignature !== built.format.headerSignature);
  };

  const save = async (load: boolean, confirmFormatChange: boolean): Promise<ActionState> => {
    if (!account || !file || !state || !built?.ok) return { status: 'error', message: '', fieldErrors: {} };
    // Endsaldo optional; unlesbar steht er am Feld, statt still ohne Saldoprüfung einzulesen (App-B7).
    const balance = readAmount(balanceText, { required: false });
    setBalanceInvalid(!balance.ok);
    if (!balance.ok) return { status: 'error', message: '', fieldErrors: {} };
    setBusy(true);
    setError(null);
    const closingBalanceCents = balance.cents ?? undefined;
    let result: ActionState;
    try {
      const formData = new FormData();
      formData.append('accountId', account.id);
      formData.append('name', state.name.trim());
      formData.append('format', JSON.stringify({ ...built.format, invertSign: state.invertSign ?? false }));
      formData.append('confirmFormatChange', String(confirmFormatChange));
      if (load) {
        formData.append('file', new Blob([file.bytes as BlobPart]), file.name);
        if (closingBalanceCents !== undefined) formData.append('closingBalanceCents', String(closingBalanceCents));
      }
      result = await saveCsvFormatAction(formData);
    } catch {
      result = { status: 'error', message: tCommon('uploadFailed'), fieldErrors: {} };
    }
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
    // Assistent in einer Karte mit der Leiste als Fuß (Entwurf E3): Schritte oben, „← Zurück · Schritt n von m ·
    // Abbrechen · Weiter“ unten, klebend wie die Speicherleiste.
    <FormCard>
    <FormCardBody className="space-y-6">
      <Steps label={t('stepsLabel')} testId="csv-steps" steps={stepsFrom(STEPS.map((s) => ({ key: String(s), label: t(`steps.${s}`) })), String(step))} />

      {step === 1 ? (
        <section className="space-y-4">
          <FormGrid>
            <FormField id="csv-account" label={t('accountLabel')}>
              <Select id="csv-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
          {/* 07-1 B22: Jeder Schritt steht in derselben Karte (E3); keine Karte in der Karte (§ E). */}
          <Section title={t('camt.title')}>
            <div className="space-y-2">
              <p className="text-body text-ink-2">{t('camt.text')}</p>
              <Link href="/help/finanzen/auszug-bei-der-bank-holen" className="text-body text-link underline underline-offset-2">
                {t('camt.link')}
              </Link>
            </div>
          </Section>
          {handoff ? (
            <div className="space-y-2 rounded-md border border-brand bg-brand-soft p-4 text-body">
              <p className="font-semibold text-ink">{t('handoff.text', { name: handoff.name })}</p>
              <p className="text-ink-2">{t('handoff.hint')}</p>
              <Button type="button" disabled={!account} onClick={() => openBytes(handoff.name, handoff.bytes)}>
                {t('handoff.continue')}
              </Button>
            </div>
          ) : null}
          {reselect && !handoff ? <Notice level="hint">{t('handoff.lost')}</Notice> : null}
          {!csvChosen ? (
            <Button type="button" variant="outline" onClick={() => setCsvChosen(true)}>
              {t('camt.csvAnyway')}
            </Button>
          ) : (
            <FormGrid>
              <FormField id="csv-file" label={t('fileLabel')} size="full">
                <FileDropzone
                  id="csv-file"
                  name="csv-file"
                  accept=".csv,.txt,text/csv,text/plain"
                  hint={t('fileHint')}
                  onFile={(chosen) => {
                    if (chosen) void chooseFile(chosen);
                  }}
                />
              </FormField>
            </FormGrid>
          )}
        </section>
      ) : null}

      {state && step === 2 ? (
        <Section title={t('settings.title')}>
          <div className="space-y-4">
            <p className="text-body text-ink-2">{t('settings.text')}</p>
            <FormGrid>
              <FormField id="csv-encoding" label={t('settings.encoding')} size="s">
                <Select id="csv-encoding" value={state.settings.encoding} onChange={(e) => update({ settings: { ...state.settings, encoding: e.target.value as AssistantState['settings']['encoding'] } })}>
                  {ENCODINGS.map((v) => (
                    <option key={v} value={v}>
                      {t(`settings.encodings.${v}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="csv-delimiter" label={t('settings.delimiter')} size="s">
                <Select id="csv-delimiter" value={state.settings.delimiter} onChange={(e) => update({ settings: { ...state.settings, delimiter: e.target.value as AssistantState['settings']['delimiter'] } })}>
                  {DELIMITERS.map((v) => (
                    <option key={v} value={v}>
                      {t(`settings.delimiters.${v === '\t' ? 'tab' : v === ';' ? 'semicolon' : v === ',' ? 'comma' : 'pipe'}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="csv-header-row" label={t('settings.headerRow')} size="s">
                <Input id="csv-header-row" type="number" min={1} max={31} value={state.settings.headerRow + 1} onChange={(e) => update({ settings: { ...state.settings, headerRow: Math.max(0, Math.min(30, Number(e.target.value) - 1)) } })} />
              </FormField>
              <FormField id="csv-date-format" label={t('settings.dateFormat')} size="s">
                <Select id="csv-date-format" value={state.settings.dateFormat ?? ''} onChange={(e) => update({ settings: { ...state.settings, dateFormat: (e.target.value || null) as AssistantState['settings']['dateFormat'] } })}>
                  <option value="">{t('settings.choose')}</option>
                  {DATE_FORMATS.map((v) => (
                    <option key={v} value={v}>
                      {t(`settings.dateFormats.${DATE_FORMAT_KEYS[v]}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="csv-decimal" label={t('settings.decimal')} size="s">
                <Select id="csv-decimal" value={state.settings.decimalSeparator ?? ''} onChange={(e) => update({ settings: { ...state.settings, decimalSeparator: (e.target.value || null) as ',' | '.' | null } })}>
                  <option value="">{t('settings.choose')}</option>
                  <option value=",">{t('settings.decimals.comma')}</option>
                  <option value=".">{t('settings.decimals.dot')}</option>
                </Select>
              </FormField>
            </FormGrid>
          </div>
        </Section>
      ) : null}

      {state && step === 3 ? (
        <>
          <ColumnsStep header={preview.header} rows={preview.rows} state={state} onChange={setState} />
          {/* Aus Schritt 2: Ohne Datumsformat und Dezimalzeichen geht es nicht weiter — das sagt weder Pflichtblock noch Leiste. */}
          {built && !built.ok && built.reason === 'settingsMissing' ? <p className="text-meta text-error">{t('columns.reasons.settingsMissing')}</p> : null}
        </>
      ) : null}

      {state && step === 4 ? (
        <Section title={signLine ? t('sign.question', { amount: formatEuro(Math.abs(signLine.amountCents)), who: signLine.counterpartyName ?? signLine.purpose }) : t('sign.title')}>
          <div className="space-y-4">
            {/* Die Vorzeichenfrage ist der Titel des Schritts, die Antwortkarten stehen darunter (Designer 2026-10-10 § 5). */}
            {signLine ? (
              <>
                <ChoiceCards
                  mode="choice"
                  name="csv-sign"
                  options={[
                    { value: 'yes', label: t('sign.yes') },
                    { value: 'no', label: t('sign.no') },
                  ]}
                  value={state.invertSign === null ? undefined : state.invertSign === signLine.amountCents > 0 ? 'yes' : 'no'}
                  onSelect={(answer) => update({ invertSign: answer === 'yes' ? signLine.amountCents > 0 : signLine.amountCents < 0 })}
                />
              </>
            ) : (
              <p className="text-body text-ink-2">{t('sign.noLine')}</p>
            )}
          </div>
        </Section>
      ) : null}

      {state && step === 5 ? (
        <Section title={t('probe.title')}>
          <div className="space-y-4">
            {read && !read.ok ? (
              <Notice level="refuse" title={t('probe.unreadable')}>
                {t(`probe.errors.${read.error.code}`, { line: read.error.line ?? '' })}
              </Notice>
            ) : null}
            {first ? (
              <dl data-testid="csv-probe" className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-md border border-line bg-surface p-4 text-body">
                <dt className="text-muted-ink">{t('probe.date')}</dt>
                <dd className="tabular-nums">{date(first.bookingDate)}</dd>
                <dt className="text-muted-ink">{t('probe.counterparty')}</dt>
                <dd>{first.counterpartyName ?? <Empty />}</dd>
                <dt className="text-muted-ink">{t('probe.iban')}</dt>
                <dd className="font-mono">{first.counterpartyIban ? formatIban(first.counterpartyIban) : <Empty />}</dd>
                <dt className="text-muted-ink">{t('probe.purpose')}</dt>
                <dd>{first.purpose || <Empty />}</dd>
                <dt className="text-muted-ink">{t('probe.amount')}</dt>
                <dd className="tabular-nums">{formatEuro(first.amountCents)}</dd>
                {fee ? (
                  <>
                    <dt className="text-muted-ink">{t('probe.fee')}</dt>
                    <dd className="tabular-nums">{formatEuro(fee.amountCents)}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            <FormGrid>
              <FormField id="csv-name" label={t('probe.nameLabel')}>
                <Input id="csv-name" value={state.name} onChange={(e) => update({ name: e.target.value })} />
              </FormField>
              {!hasBalanceColumn && read?.ok ? (
                <FormField id="csv-balance" label={t('probe.balanceLabel', { date: date(read.statement.to) })} size="s" error={balanceInvalid ? tAmount('format') : undefined}>
                  <Input id="csv-balance" unit="€" inputMode="decimal" value={balanceText} onChange={(e) => { setBalanceText(e.target.value); setBalanceInvalid(false); }} />
                </FormField>
              ) : null}
            </FormGrid>
            {error ? <Notice level="refuse">{error}</Notice> : null}
          </div>
        </Section>
      ) : null}

    </FormCardBody>
      {state && step > 1 ? (
        <FormActionBar
          variant="wizard"
          wizard={{ step, total: STEPS.length, onBack: () => (step === 2 ? (setState(null), setFile(null)) : goTo((step - 1) as AssistantStep)) }}
          back={{ href: '/finance/imports', label: t('cancelTarget') }}
          testId="csv-wizard-bar"
          {...(step < 5
            ? {
                onSave: () => goTo((step + 1) as AssistantStep),
                saveLabel: t('next'),
                saveDisabled: !canAdvance(step, state, preview.header),
                // Schritt 3: Die Leiste wiederholt, was im Pflichtblock offen ist — sichtbar auch weit unten in der Liste.
                ...(step === 3 ? { note: columnsNote(preview.header, state, tColumns) } : {}),
              }
            : {
                // Im letzten Schritt nennt der Primärknopf die Handlung (E3); „Nur speichern“ daneben, wo Einlesen geht.
                onSave: () => requestSave(canLoad),
                saveLabel: canLoad ? t('probe.saveAndLoad') : t('probe.saveOnly'),
                pending: busy,
                saveDisabled: !read?.ok || !canAdvance(5, state, preview.header),
                extraActions: canLoad ? (
                  <Button type="button" variant="outline" disabled={busy || !read?.ok || !canAdvance(5, state, preview.header)} onClick={() => requestSave(false)}>
                    {t('probe.saveOnly')}
                  </Button>
                ) : undefined,
              })}
        />
      ) : null}

      <ConfirmDialog
        open={pendingLoad !== null}
        onOpenChange={(open) => !open && setPendingLoad(null)}
        title={t('switchDialog.title')}
        description={t('switchDialog.description')}
        confirmLabel={t('switchDialog.confirm')}
        action={() => save(pendingLoad ?? false, true)}
      />
    </FormCard>
  );
}
