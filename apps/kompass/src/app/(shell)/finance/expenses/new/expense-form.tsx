'use client';

import type { ExpenseClaimView } from '@kompass/module-finance';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useAutosave, type SaveOutcome } from '@/components/forms/use-autosave';
import { Notice, type NoticeRemedy } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ActionState } from '@/lib/actions';
import { formatEuro } from '@/lib/finance/amount';
import { applySaved, draftInput, emptyPosition, receiptProblem, totalCents, type Device, type ExpenseForm as FormState, type MileageRate, type PositionForm } from '@/lib/finance/expenses';
import { checkIban, groupIban } from '@/lib/finance/iban-check';
import { saveExpenseDraftAction, submitExpenseClaimAction, uploadExpenseReceiptAction } from '../actions';
import type { PdfFieldError } from './pdf-field';
import { countPdfPages } from '@/lib/finance/pdf-pages';
import { PositionCard } from './position-card';

let keySeq = 0;
const nextKey = () => `n${Date.now().toString(36)}${(keySeq++).toString(36)}`;

interface Refusal {
  message: string;
  /** Position (1-basiert), der der Beleg fehlt — der erste Ausweg springt zu ihrem PDF-Feld. */
  missingReceipt: { n: number; key: string } | null;
}

/**
 * D1 „Auslage einreichen“ (F8a Task 5). Der Stand liegt am Server: Jede
 * Eingabe wird nach 800 ms Ruhe und beim Verlassen der Seite
 * (`visibilitychange`) als Entwurf gesichert — der Wechsel in die Scan-App
 * kostet nichts. Die Sicherungen laufen nacheinander, jede mit der Version
 * der vorigen (`expectedVersion`); nur der jüngste Stand geht hinaus.
 * „Einreichen“ ist nie deaktiviert: Fehlt etwas, steht die Ablehnung mit
 * Auswegen über den Knöpfen.
 */
export function ExpenseForm({
  initial,
  initialWarnings = [],
  prefilledIban,
  contactName,
  waiversEnabled,
  waiverAvailable,
  waiverUnavailableNames,
  mileageRates,
  projects,
  device,
  maxBytes,
  today,
}: {
  initial: FormState;
  /** Befund 35: Hinweise des letzten Speicherstands (`ExpenseClaimView.warnings`). */
  initialWarnings?: string[];
  prefilledIban: string | null;
  contactName: string;
  waiversEnabled: boolean;
  /** Befund 8: der Schalter allein reicht nicht — ohne Anspruchsgrundlage bleibt der Verzicht unverfügbar. */
  waiverAvailable: boolean;
  waiverUnavailableNames: string[];
  mileageRates: MileageRate[];
  projects: { id: string; name: string }[] | null;
  device: Device;
  maxBytes: number;
  today: string;
}) {
  const t = useTranslations('finance.expenses.new');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [ibanLocked, setIbanLocked] = useState(() => initial.iban !== '' && checkIban(initial.iban).state === 'valid');
  // Befund 35: die IBAN, für die der Dienst „gehört einer anderen Person“ gemeldet hat — gilt nur, solange das Feld sie noch trägt.
  const [foreignIban, setForeignIban] = useState<string | null>(() => (initialWarnings.includes('ibanBelongsToOtherContact') ? compactIban(initial.iban) : null));
  // Prüfer-Fixrunde 28.09., Punkt 4: die Grundlage ist jünger als die früheste Position — als Verzicht geht der Antrag nicht durch.
  const [agreedLate, setAgreedLate] = useState(() => initialWarnings.includes('waiverAgreedAfterPosition'));
  const [uploading, setUploading] = useState<string | null>(null);
  const [pdfErrors, setPdfErrors] = useState<Record<string, PdfFieldError>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstFieldRefs = useRef(new Map<string, HTMLInputElement>());

  /** Eine Sicherung des jüngsten Stands; die Antwort wird in den Stand zum Zeitpunkt der Antwort eingeführt. */
  const saveDraft = useCallback(async (current: FormState): Promise<SaveOutcome<FormState>> => {
    const { input, keys } = draftInput(current);
    const state: ActionState = await saveExpenseDraftAction(input);
    if (state.status !== 'success') return { kind: 'failed', detail: state.status === 'error' ? state.message : '' };
    const view = state.data as ExpenseClaimView;
    setForeignIban(view.warnings.includes('ibanBelongsToOtherContact') ? view.iban : null);
    setAgreedLate(view.warnings.includes('waiverAgreedAfterPosition'));
    // Die Adresse trägt den Entwurf: Neu laden oder am Rechner öffnen holt ihn zurück.
    if (current.id === null) window.history.replaceState(null, '', `/finance/expenses/new?id=${view.id}`);
    return { kind: 'saved', at: view.version, apply: (latest) => applySaved(latest, keys, view) };
  }, []);

  const auto = useAutosave<FormState>({ initial, ...(initial.version ? { initialState: { kind: 'saved', at: initial.version } } : {}), save: saveDraft });
  const { value: form, state: save, pending, flush, markDirty, get: current, set: commit, setState: setSave, update: autoUpdate } = auto;

  const update = useCallback(
    (fn: (f: FormState) => FormState) => {
      setRefusal(null);
      autoUpdate(fn);
    },
    [autoUpdate],
  );

  const updatePosition = (key: string, patch: Partial<PositionForm>) => {
    update((f) => ({ ...f, positions: f.positions.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
    const touched = Object.keys(patch).map((k) => (k === 'amountText' ? 'amountCents' : k));
    setFieldErrors((all) => {
      const own = all[key];
      if (!own) return all;
      return { ...all, [key]: Object.fromEntries(Object.entries(own).filter(([field]) => !touched.includes(field))) };
    });
  };

  useEffect(() => {
    if (!focusKey) return;
    firstFieldRefs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const addPosition = () => {
    const key = nextKey();
    update((f) => ({ ...f, positions: [...f.positions, emptyPosition(key, today)] }));
    setFocusKey(key);
  };

  const pickFile = async (key: string, file: File) => {
    const problem = receiptProblem(file, maxBytes);
    if (problem) {
      setPdfErrors((all) => ({ ...all, [key]: { kind: problem, fileName: file.name } }));
      return;
    }
    setPdfErrors(({ [key]: _gone, ...rest }) => rest);
    setUploading(key);
    try {
      // Der Beleg hängt an einer gesicherten Position — also erst sichern, dann ablegen.
      if (!current().id || !current().positions.find((p) => p.key === key)?.id) markDirty();
      const saved = await flush();
      const position = saved?.positions.find((p) => p.key === key);
      if (!saved?.id || !position?.id) return;
      const formData = new FormData();
      formData.append('claimId', saved.id);
      formData.append('positionId', position.id);
      formData.append('file', file);
      const state = await uploadExpenseReceiptAction(formData);
      if (state.status !== 'success') {
        setPdfErrors((all) => ({ ...all, [key]: { kind: 'server', detail: state.status === 'error' ? state.message : '' } }));
        return;
      }
      const view = state.data as ExpenseClaimView;
      const filed = view.positions.find((p) => p.id === position.id);
      const pageCount = countPdfPages(new Uint8Array(await file.arrayBuffer()));
      // Der Beleg ändert die Version nicht — kein neuer Entwurfsstand, nur die Dateizeile.
      commit({ ...current(), positions: current().positions.map((p) => (p.key === key ? { ...p, documentNumber: filed?.documentNumber ?? null, fileName: file.name, fileSize: file.size, pageCount } : p)) });
      setRefusal(null);
    } catch (error) {
      // Nur ein echter Netzwerkfehler ist „offline“ (Browser wirft dafür ein TypeError) — eine Ablehnung des Servers (500) ist ein Fehler, keine fehlende Verbindung.
      if (error instanceof TypeError) setSave({ kind: 'offline' });
      else setPdfErrors((all) => ({ ...all, [key]: { kind: 'server', detail: tCommon('uploadFailed') } }));
    } finally {
      setUploading(null);
    }
  };

  const keepDraft = async () => {
    if (!current().id) markDirty();
    const saved = await flush();
    if (saved) router.push('/finance/expenses');
  };

  const focusPdf = (key: string) => {
    const button = document.getElementById(`pdf-${key}`);
    button?.scrollIntoView({ block: 'center' });
    button?.focus();
  };

  const submit = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      if (!current().id) markDirty();
      const saved = await flush();
      if (!saved?.id) return;
      const state = await submitExpenseClaimAction(saved.id, saved.version);
      if (state.status === 'success') {
        router.refresh();
        return;
      }
      if (state.status !== 'error') return;
      const byIndex: Record<string, Record<string, string>> = {};
      for (const [path, message] of Object.entries(state.fieldErrors)) {
        const match = /^positions\.(\d+)\.(\w+)$/.exec(path);
        const position = match ? saved.positions[Number(match[1])] : undefined;
        if (position && match) byIndex[position.key] = { ...byIndex[position.key], [match[2]!]: message };
      }
      setFieldErrors(byIndex);
      const index = state.code === 'expensePositionNeedsReceipt' ? current().positions.findIndex((p) => p.kind === 'receipt' && p.documentNumber === null && p.fileName === null) : -1;
      setRefusal({ message: state.message, missingReceipt: index >= 0 ? { n: index + 1, key: current().positions[index]!.key } : null });
    } catch {
      setSave({ kind: 'offline' });
    } finally {
      setBusy(false);
    }
  };

  const remedies: NoticeRemedy[] = [
    ...(refusal?.missingReceipt ? [{ label: t('refuse.pickPdf', { n: refusal.missingReceipt.n }), onSelect: () => focusPdf(refusal.missingReceipt!.key) }] : []),
    { label: t('keepDraft'), onSelect: () => void keepDraft() },
  ];
  const iban = checkIban(form.iban);

  return (
    <div className="space-y-5">
      <div data-testid="expense-for-whom" className="flex min-h-[var(--field-h)] items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
        <span className="text-[13px] text-muted-ink">{t('forWhom')}</span>
        <span className="text-[14px] font-semibold text-ink">{contactName}</span>
      </div>

      <section aria-labelledby="expense-positions" className="space-y-3">
        <h3 id="expense-positions" className="sr-only">
          {t('positions')}
        </h3>
        <ol className="space-y-3">
          {form.positions.map((p, i) => (
            <PositionCard
              key={p.key}
              position={p}
              n={i + 1}
              rates={mileageRates}
              projects={projects}
              errors={fieldErrors[p.key] ?? {}}
              canRemove={form.positions.length > 1}
              onChange={(patch) => updatePosition(p.key, patch)}
              onRemove={() => update((f) => ({ ...f, positions: f.positions.filter((x) => x.key !== p.key) }))}
              firstFieldRef={(el) => {
                if (el) firstFieldRefs.current.set(p.key, el);
                else firstFieldRefs.current.delete(p.key);
              }}
              pdf={{ uploading: uploading === p.key, error: pdfErrors[p.key] ?? null, device, maxBytes, onPick: (file) => void pickFile(p.key, file) }}
            />
          ))}
        </ol>
        <Button type="button" variant="outline" className="w-full" onClick={addPosition}>
          {t('addPosition')}
        </Button>
      </section>

      <section aria-labelledby="expense-refund" className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <h3 id="expense-refund" className="text-[15px] font-semibold">
          {t('refund')}
        </h3>
        <div data-testid="expense-total" className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold text-muted-ink">{t('total')}</span>
          <span className="font-mono text-[22px] font-semibold tabular-nums">{formatEuro(totalCents(form, mileageRates))}</span>
        </div>

        {waiversEnabled && waiverAvailable ? (
          <div className="space-y-1.5 rounded-md bg-surface-2 p-3">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="expense-waiver">{t('waiver.label')}</Label>
              <Switch id="expense-waiver" aria-label={t('waiver.label')} checked={form.waiver} onCheckedChange={(waiver) => update((f) => ({ ...f, waiver }))} />
            </div>
            <p className="text-[13px] text-ink-2">{t('waiver.text')}</p>
            {form.waiver ? (
              <div className="space-y-1 border-t border-line pt-2">
                <FormField id="expense-recurring" label={t('waiver.recurring')} hint={t('waiver.recurringHint')} toggle>
                  <Checkbox id="expense-recurring" checked={form.recurring} onCheckedChange={(next) => update((f) => ({ ...f, recurring: next === true }))} />
                </FormField>
                {agreedLate ? (
                  <div data-testid="expense-waiver-agreed-late">
                    <Notice level="warn">{t('waiver.agreedAfterPosition')}</Notice>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : waiversEnabled ? (
          <p className="text-[13px] text-ink-2">
            {waiverUnavailableNames.length > 0 ? t('waiver.unavailableWithNames', { names: waiverUnavailableNames.join(', ') }) : t('waiver.unavailable')}
          </p>
        ) : null}

        {form.waiver ? null : (
          <FormGrid>
            {ibanLocked ? (
              <FormCell size="m" className="space-y-1">
                <p id="expense-iban-label" className="text-sm font-medium">
                  {t('iban')}
                </p>
                <div className="flex min-h-[var(--field-h)] items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3">
                  <span data-testid="iban-fixed" aria-labelledby="expense-iban-label" className="font-mono text-[14px] tabular-nums">
                    {groupIban(form.iban)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIbanLocked(false);
                      update((f) => ({ ...f, iban: '' }));
                    }}
                  >
                    {t('otherIban')}
                  </Button>
                </div>
                <p className="text-[12px] text-muted-ink">{form.iban === prefilledIban ? `${t('ibanHint')} (${t('ibanPrefilled')})` : t('ibanHint')}</p>
              </FormCell>
            ) : (
              <FormField id="expense-iban" label={t('iban')}>
                <Input id="expense-iban" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={form.iban} aria-invalid={iban.state === 'checksum' || undefined} onChange={(e) => update((f) => ({ ...f, iban: e.target.value }))} />
                <p aria-live="polite" className={iban.state === 'valid' || iban.state === 'empty' ? 'text-[12px] text-muted-ink' : 'text-[12px] text-error'}>
                  {iban.state === 'empty' ? t('ibanHint') : t(`ibanCheck.${iban.state}`)}
                </p>
              </FormField>
            )}
          </FormGrid>
        )}
        {!form.waiver && foreignIban !== null && foreignIban === compactIban(form.iban) ? (
          <div data-testid="iban-other-contact">
            <Notice level="hint">{t('ibanOtherContact')}</Notice>
          </div>
        ) : null}
      </section>

      <FormActionBar
        mode="create"
        testId="expense-footer"
        status={{ state: save, pending }}
        extraActions={
          <Button type="button" variant="outline" disabled={busy} onClick={() => void keepDraft()}>
            {t('keepDraft')}
          </Button>
        }
        saveLabel={t('submit')}
        onSave={() => void submit()}
        pending={busy}
        state={refusal ? { status: 'error', message: refusal.message, title: t('refuse.title'), remedies, fieldErrors: {} } : undefined}
      />
    </div>
  );
}

/** Wie der Dienst die IBAN speichert: ohne Leerzeichen, in Großbuchstaben. */
function compactIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}
