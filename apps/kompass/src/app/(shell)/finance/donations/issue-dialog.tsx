'use client';

import type { ConfirmationCheck, ConfirmationCheckResult, FinanceInKindDetailsRow } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { Notice } from '@/components/notice';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { issueAllowed, signatureMode } from '@/lib/finance/donations';
import { issueConfirmationAction, loadIssueCheckAction, saveInKindDetailsAction } from './actions';

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
    const result = await issueConfirmationAction({ lineIds: [lineId], issuedOn });
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      void load();
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
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
      <DialogContent layout="fixed-footer" className="h-[85vh] bg-surface shadow-md sm:max-w-[1040px]">
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
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-ink">{t('requirements')}</h3>
                <RequirementList items={items} grouping="open-first" />
                {check.kind === 'inKind' ? (
                  <InKindForm lineId={lineId} valueCents={check.lines[0]?.amountCents ?? 0} details={loaded?.inKindDetails ?? null} canDescribe={canDescribe} onSaved={() => void load()} />
                ) : null}
              </div>
              <div className="flex min-h-[420px] flex-col gap-2 border-t border-line px-5 py-4 lg:min-h-0 lg:border-t-0 lg:border-l">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-ink">{t('preview')}</h3>
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
        <DialogFooter className="sm:items-end sm:justify-between">
          {check ? (
            <div className="flex flex-wrap items-end gap-5">
              <div className="space-y-1.5">
                <Label htmlFor="issue-date" required>{t('issuedOn')}</Label>
                <Input id="issue-date" type="date" value={issuedOn} max={today} onChange={(e) => setIssuedOn(e.target.value)} required />
              </div>
              <div className="space-y-1 text-[13px]">
                <p className="text-[12px] font-semibold text-muted-ink">{t('signatureLabel')}</p>
                <p data-testid="issue-signature-mode" className="font-semibold text-ink">{mode ? t(`signatureMode.${mode}`) : ''}</p>
              </div>
              <p className="max-w-[260px] text-[12px] text-muted-ink">{t('humanOnly')}</p>
            </div>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
            <Button type="button" disabled={!allowed} onClick={() => void submit()}>{t('submit')}</Button>
          </div>
        </DialogFooter>
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

  const business = origin === 'business';
  const withdrawalCents = parseAmount(withdrawal);
  const vatCents = parseAmount(vat);
  const proofId = proof?.id ?? details?.proofDocumentId ?? null;
  const complete = item.trim() && condition.trim() && valuation.trim() && (!business || (withdrawalCents !== null && vatCents !== null));

  const save = async () => {
    setPending(true);
    const result = await saveInKindDetailsAction({ lineId, item, condition, valuation, origin, withdrawalValueCents: business ? withdrawalCents : null, vatCents: business ? vatCents : null, proofDocumentId: proofId });
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onSaved();
    }
  };

  return (
    <fieldset className="space-y-3 rounded-md border border-line p-3.5" disabled={!canDescribe}>
      <legend className="px-1 text-[13px] font-semibold text-ink">{tk('title')}</legend>
      <div className="space-y-1.5">
        <Label htmlFor="in-kind-item" required>{tk('item')}</Label>
        <Input id="in-kind-item" value={item} onChange={(e) => setItem(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="in-kind-condition" required>{tk('condition')}</Label>
        <Input id="in-kind-condition" value={condition} onChange={(e) => setCondition(e.target.value)} />
      </div>
      <div className="space-y-1">
        <p className="text-[13px] font-semibold text-ink-2">{tk('value')}</p>
        <p className="font-mono tabular-nums text-ink">{formatEuro(valueCents)}</p>
        <p className="text-[12px] text-muted-ink">{tk('valueHint')}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="in-kind-valuation" required>{tk('valuation')}</Label>
        <textarea id="in-kind-valuation" value={valuation} onChange={(e) => setValuation(e.target.value)} rows={2} className="w-full rounded-sm border border-line-strong bg-field px-2.5 py-1.5 text-[13px]" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="in-kind-origin" required>{tk('origin')}</Label>
        <Select id="in-kind-origin" value={origin} onChange={(e) => setOrigin(e.target.value as 'private' | 'business')}>
          <option value="private">{tk('originOptions.private')}</option>
          <option value="business">{tk('originOptions.business')}</option>
        </Select>
      </div>
      {business ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="in-kind-withdrawal" required>{tk('withdrawalValue')}</Label>
            <AmountField id="in-kind-withdrawal" name="withdrawalValue" value={withdrawal} onChange={setWithdrawal} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="in-kind-vat" required>{tk('vat')}</Label>
            <AmountField id="in-kind-vat" name="vat" value={vat} onChange={setVat} required />
          </div>
        </div>
      ) : null}
      <DocumentPicker id="in-kind-proof" name="proofDocument" label={tk('proof')} value={proof} onChange={setProof} />
      {!proof && details?.proofDocumentId ? <p className="text-[12px] text-muted-ink">{tk('proofKept')}</p> : null}
      <Button type="button" variant="outline" disabled={!complete || pending} onClick={() => void save()}>{tk('save')}</Button>
    </fieldset>
  );
}
