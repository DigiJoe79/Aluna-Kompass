'use client';

import type { ConfirmationBlockingEntry, ConfirmationCheck, ConfirmationCheckResult, FinanceInKindDetailsRow } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { issueAllowed, signatureMode } from '@/lib/finance/donations';
import { issueConfirmationAction, loadIssueCheckAction, saveInKindDetailsAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid, FormRowBreak } from '@/components/forms/form-grid';

type Loaded = { check: ConfirmationCheckResult; inKindDetails: FinanceInKindDetailsRow | null };
type Preview = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; url: string } | { state: 'failed'; message: string };

/**
 * „Zuwendungsbestätigung ausstellen“ (C1, F6a Task 7; N3 C1-1–C1-3): Kopf
 * (Spender, Betrag, Buchungen) und Fußleiste (Ausstellungsdatum, die
 * Unterschrift aus dem Stand des maschinellen Verfahrens — nicht wählbar —,
 * „nur ein Mensch“, „Ausstellen“) stehen; links scrollt die Prüfliste in vier
 * Gruppen, rechts steht die Vorschau als PDF mit Wasserzeichen ENTWURF (400 px).
 * Bei einer Sachspende folgt unter der Liste das Formular ihrer Angaben. Aus
 * der Liste „Noch nicht bestätigt“ und aus der Buchungsansicht.
 */
export function IssueDialog({ lineId, contactName, open, onOpenChange, today, canDescribe }: { lineId: string; /** Im Kopf neben Betrag und Buchungen; die Buchungsansicht kennt ihn nicht einzeln. */ contactName?: string; open: boolean; onOpenChange: (open: boolean) => void; today: string; canDescribe: boolean }) {
  const t = useTranslations('finance.donations.issue');
  const tc = useTranslations('finance.donations');
  const { date } = useDateFormat();
  const router = useRouter();
  const [issuedOn, setIssuedOn] = useState(today);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const load = useCallback(async () => {
    const result = await loadIssueCheckAction([lineId], issuedOn);
    if (result.status === 'error') {
      setLoadError(result.message);
      return;
    }
    if (result.status === 'success') {
      setLoadError(null);
      setLoaded(result.data as Loaded);
    }
  }, [lineId, issuedOn]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const ready = loaded?.check.ok === true;
  useEffect(() => {
    if (!open || !ready || !issuedOn) {
      setPreview({ state: 'idle' });
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    setPreview({ state: 'loading' });
    void (async () => {
      const response = await fetch('/finance/donations/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lineIds: [lineId], issuedOn }) });
      if (cancelled) return;
      if (!response.ok) {
        const body = response.status === 409 ? ((await response.json()) as { message?: string }) : null;
        setPreview({ state: 'failed', message: body?.message ?? String(response.status) });
        return;
      }
      url = URL.createObjectURL(await response.blob());
      if (cancelled) URL.revokeObjectURL(url);
      else setPreview({ state: 'ready', url });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, ready, lineId, issuedOn, loaded]);

  const check = loaded?.check ?? null;
  const allowed = issueAllowed(check) && !pending;

  const submit = async () => {
    if (!check) return;
    setPending(true);
    const result = await feedback.run(() => issueConfirmationAction({ lineIds: [lineId], issuedOn }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'error') {
      void load();
      return;
    }
    if (result.status === 'success') {
      onOpenChange(false);
      router.refresh();
    }
  };

  const fieldNames = (value: unknown) =>
    String(value ?? '')
      .split(',')
      .filter(Boolean)
      .map((field) => tc(`fields.${field}`))
      .join(', ');

  const blockingOf = (c: ConfirmationCheck): ConfirmationBlockingEntry[] => (Array.isArray(c.detail.entries) ? c.detail.entries : []);
  const blockingText = (e: ConfirmationBlockingEntry) =>
    e.entryNumber ? t('detail.blockingEntry', { number: e.entryNumber, date: date(e.entryDate), amount: formatEuro(Math.abs(e.amountCents)) }) : t('detail.blockingDraft', { date: date(e.entryDate), amount: formatEuro(Math.abs(e.amountCents)) });
  const blockingLinks = (c: ConfirmationCheck) => {
    const rest = c.done ? [] : blockingOf(c).slice(1);
    return rest.length === 0 ? undefined : (
      <span className="flex flex-wrap gap-3">
        {rest.map((e) => (
          <Link key={e.entryId} href={e.href} className="text-[12px] text-link underline">
            {e.entryNumber ? t('detail.openBlockingEntry', { number: e.entryNumber }) : t('detail.openBlockingDraft', { date: date(e.entryDate) })}
          </Link>
        ))}
      </span>
    );
  };

  const detailOf = (c: ConfirmationCheck): string | undefined => {
    if (c.key === 'noticeValid') {
      if (c.done && check?.notice) return t('detail.notice', { kind: tc(`noticeKind.${check.notice.kind}`), date: date(check.notice.noticeDate), until: date(check.notice.validUntil) });
      if (!c.done) return t('detail.noNotice', { date: date(String(c.detail.date ?? issuedOn)) });
    }
    if (c.done && c.key !== 'signerValid') return undefined;
    switch (c.key) {
      case 'contactComplete':
      case 'organizationAddress':
      case 'inKindDetails':
        return t('detail.missing', { fields: fieldNames(c.detail.missing) });
      case 'notConfirmed':
        return t('detail.confirmed', { number: String(c.detail.number ?? '') });
      case 'certifiable':
        return t('detail.category', { category: String(c.detail.category ?? '') });
      case 'afterExemptionStart':
        return t('detail.beforeExemption', { entryDate: date(String(c.detail.entryDate ?? '')), exemptFrom: date(String(c.detail.exemptFrom ?? '')) });
      case 'issuedAfterDonation':
        return t('detail.beforeDonation', { issuedOn: date(String(c.detail.issuedOn ?? issuedOn)), lastDonationDate: date(String(c.detail.lastDonationDate ?? '')) });
      case 'noticeComplete':
        return t('detail.noticeIncomplete');
      // N4: alle sperrenden Buchungen — die Abhilfe springt zur ersten, `extra` verlinkt die übrigen.
      case 'possibleReturnWithoutOrigin':
      case 'returnDraftPending':
        return blockingOf(c).length > 0 ? t('detail.blockingEntries', { entries: blockingOf(c).map(blockingText).join('; ') }) : undefined;
      case 'signerValid':
        return c.applies && c.warning === null ? t('detail.machine') : t('detail.signatureField');
      default:
        return undefined;
    }
  };

  const warningText = (c: ConfirmationCheck): string | null => {
    if (c.warning === null) return null;
    // Organisation und Ausland können beide zutreffen; der Dienst führt beide in `warnings`.
    if (c.key === 'contactComplete') return (check?.warnings ?? []).filter((w) => w === 'organization' || w === 'foreignCountry').map((w) => t(`warnings.${w}`)).join(' ') || null;
    if (c.warning === 'signatureField') return t('detail.signatureField');
    return t(`warnings.${c.warning as 'organization' | 'foreignCountry'}`);
  };

  const items: RequirementListItem[] = check
    ? check.checks.map((c) => {
        const text = warningText(c);
        return {
          key: c.key,
          title: tc(`checks.${c.key}`),
          done: c.done,
          blocked: c.blocked,
          applies: c.applies,
          warning: text ? { text } : undefined,
          detail: detailOf(c),
          extra: blockingLinks(c),
          canSelf: !!c.remedy?.href,
          canDoNames: [],
          canDoText: '',
          href: c.remedy?.href ?? '',
          actionLabel: c.remedy ? tc(`remedy.${c.remedy.labelKey}`) : t('missing'),
          doneLabel: t('done'),
        };
      })
    : [];

  const mode = check ? signatureMode(check) : null;
  const netCents = check ? check.lines.reduce((sum, line) => sum + line.netCents, 0) : 0;
  const entryNumbers = check ? check.lines.map((line) => line.entryNumber ?? line.entryId) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" layout="fixed-footer" className="h-[85vh] bg-surface shadow-md">
        <DialogHeader data-testid="issue-dialog-head">
          <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
          {check ? (
            <p className="text-[13px] text-ink-2">
              {contactName ? <span className="font-semibold text-ink">{contactName} · </span> : null}
              <span className="font-mono tabular-nums text-ink">{formatEuro(netCents)}</span>
              {entryNumbers.length > 0 ? <span> · {t('headLines', { count: entryNumbers.length, numbers: entryNumbers.join(', ') })}</span> : null}
            </p>
          ) : null}
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-0 p-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          {loadError ? (
            <div className="px-5 py-4 lg:col-span-2">
              <Notice level="refuse">{loadError}</Notice>
            </div>
          ) : !check ? (
            <p className="px-5 py-4 text-[13px] text-muted-ink lg:col-span-2">{t('loading')}</p>
          ) : (
            <>
              <div data-testid="issue-requirements" className="min-h-0 space-y-4 px-5 py-4 lg:overflow-auto">
                <h3 className="text-[15px] font-semibold">{t('requirements')}</h3>
                <RequirementList items={items} grouping="open-first" />
                {check.kind === 'inKind' ? (
                  <InKindForm lineId={lineId} valueCents={check.lines[0]?.amountCents ?? 0} details={loaded?.inKindDetails ?? null} canDescribe={canDescribe} onSaved={() => void load()} />
                ) : null}
              </div>
              <div className="flex min-h-[420px] flex-col gap-2 border-t border-line px-5 py-4 lg:min-h-0 lg:border-t-0 lg:border-l">
                <h3 className="text-[15px] font-semibold">{t('preview')}</h3>
                {preview.state === 'ready' ? (
                  <iframe data-testid="confirmation-preview" title={t('previewTitle')} src={preview.url} className="min-h-0 w-full flex-1 rounded-md border border-line bg-surface-2" />
                ) : (
                  <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-line-strong bg-surface-2 p-6 text-center text-[13px] text-muted-ink">
                    {preview.state === 'loading' ? t('previewLoading') : preview.state === 'failed' ? t('previewFailed', { message: preview.message }) : t('previewWaiting')}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogBody>
        <FormActionBar
          placement="dialog"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveDisabled={!allowed}
          saveLabel={t('submit')}
          onSave={() => void submit()}
          state={feedback.state}
          note={
            check ? (
              <div className="flex flex-wrap items-end gap-5">
                <FormField id="issue-date" label={t('issuedOn')} required>
                  <Input id="issue-date" type="date" value={issuedOn} max={today} onChange={(e) => setIssuedOn(e.target.value)} required />
                </FormField>
                <div className="space-y-1 text-[13px]">
                  <p className="text-[12px] font-semibold text-muted-ink">{t('signatureLabel')}</p>
                  <p data-testid="issue-signature-mode" className="font-semibold text-ink">{mode ? t(`signatureMode.${mode}`) : ''}</p>
                </div>
                <p className="max-w-prose text-[12px] text-muted-ink">{t('humanOnly')}</p>
              </div>
            ) : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Die Angaben zur Sachspende (Prüfstein 5): Gegenstand, Zustand und Alter,
 * Wert (aus der Buchung, nicht änderbar), Wertermittlung, Herkunft — bei
 * Betriebsvermögen Entnahmewert und Umsatzsteuer — und die Wertunterlage aus
 * der Akte. Gespeichert vor dem Ausstellen; danach prüft der Dialog neu.
 */
function InKindForm({ lineId, valueCents, details, canDescribe, onSaved }: { lineId: string; valueCents: number; details: FinanceInKindDetailsRow | null; canDescribe: boolean; onSaved: () => void }) {
  const tk = useTranslations('finance.donations.inKind');
  const [item, setItem] = useState(details?.item ?? '');
  const [condition, setCondition] = useState(details?.condition ?? '');
  const [valuation, setValuation] = useState(details?.valuation ?? '');
  const [origin, setOrigin] = useState<'private' | 'business'>(details?.origin ?? 'private');
  const [withdrawal, setWithdrawal] = useState(details?.withdrawalValueCents != null ? formatAmount(details.withdrawalValueCents) : '');
  const [vat, setVat] = useState(details?.vatCents != null ? formatAmount(details.vatCents) : '');
  const [proof, setProof] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const business = origin === 'business';
  const withdrawalCents = parseAmount(withdrawal);
  const vatCents = parseAmount(vat);
  const proofId = proof?.id ?? details?.proofDocumentId ?? null;
  const complete = item.trim() && condition.trim() && valuation.trim() && (!business || (withdrawalCents !== null && vatCents !== null));

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => saveInKindDetailsAction({ lineId, item, condition, valuation, origin, withdrawalValueCents: business ? withdrawalCents : null, vatCents: business ? vatCents : null, proofDocumentId: proofId }), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') {
      onSaved();
    }
  };

  return (
    <fieldset className="space-y-3 rounded-md border border-line p-3.5" disabled={!canDescribe}>
      <legend className="px-1 text-[13px] font-semibold text-ink">{tk('title')}</legend>
      <FormGrid>
        <FormField id="in-kind-item" label={tk('item')} required>
          <Input id="in-kind-item" value={item} onChange={(e) => setItem(e.target.value)} />
        </FormField>
        <FormField id="in-kind-condition" label={tk('condition')} required>
          <Input id="in-kind-condition" value={condition} onChange={(e) => setCondition(e.target.value)} />
        </FormField>
        <FormCell size="full" className="space-y-1">
          <p className="text-[13px] font-semibold text-ink-2">{tk('value')}</p>
          <p className="font-mono tabular-nums text-ink">{formatEuro(valueCents)}</p>
          <p className="text-[12px] text-muted-ink">{tk('valueHint')}</p>
        </FormCell>
        <FormField id="in-kind-valuation" label={tk('valuation')} required size="l">
          <Textarea id="in-kind-valuation" value={valuation} onChange={(e) => setValuation(e.target.value)} rows={2} />
        </FormField>
        <FormRowBreak />
        <FormField id="in-kind-origin" label={tk('origin')} required size="s">
          <Select id="in-kind-origin" value={origin} onChange={(e) => setOrigin(e.target.value as 'private' | 'business')}>
            <option value="private">{tk('originOptions.private')}</option>
            <option value="business">{tk('originOptions.business')}</option>
          </Select>
        </FormField>
        {business ? (
          <>
            <FormField id="in-kind-withdrawal" label={tk('withdrawalValue')} required size="s">
              <AmountField id="in-kind-withdrawal" name="withdrawalValue" value={withdrawal} onChange={setWithdrawal} required />
            </FormField>
            <FormField id="in-kind-vat" label={tk('vat')} required size="s">
              <AmountField id="in-kind-vat" name="vat" value={vat} onChange={setVat} required />
            </FormField>
          </>
        ) : null}
        <FormRowBreak />
        <FormCell size="m">
          <DocumentPicker id="in-kind-proof" name="proofDocument" label={tk('proof')} value={proof} onChange={setProof} />
        </FormCell>
      </FormGrid>
      {!proof && details?.proofDocumentId ? <p className="text-[12px] text-muted-ink">{tk('proofKept')}</p> : null}
      <RefusalNotice action state={feedback.state} />
      <Button type="button" variant="outline" disabled={!complete || pending} onClick={() => void save()}>{tk('save')}</Button>
    </fieldset>
  );
}
