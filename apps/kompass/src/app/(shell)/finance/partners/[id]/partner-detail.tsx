'use client';

import type { PartnerNoticeView, PartnerView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ChoiceCards } from '@/components/choice-cards';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatEuro } from '@/lib/finance/amount';
import { savePartnerNoticeAction, savePartnerPaymentDraftAction, savePartnerProfileAction, voidPartnerNoticeAction } from '../actions';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';

type Status = PartnerView['status'];
type Basis = 'transfer58' | 'agent57';

interface PaymentRow {
  id: string;
  number: string | null;
  state: 'draft' | 'submitted' | 'approved' | 'rejected';
  activeStep: 'draft' | 'submitted' | 'approved' | 'paid' | 'acknowledged' | null;
  /** U Rest: die betrachtende Person könnte die Nachweise jetzt anerkennen (Dienst, eine Quelle mit der Kachel). */
  readyToAcknowledge: boolean;
  totalCents: number;
  purposeText: string;
  date: string;
}

/** Zustand einer Zahlung aus Zustand und Schritt (Artboard 4a): „gezahlt“, „Nachweis anerkannt“ statt nur „freigegeben“. */
const paymentStateKey = (p: PaymentRow) => (p.state === 'approved' && (p.activeStep === 'paid' || p.activeStep === 'acknowledged') ? p.activeStep : p.state);

const PROOF_MONTHS = Array.from({ length: 24 }, (_, i) => i + 1);

/** Ein hinterlegtes Dokument, so weit die Akte es dieser Person zeigt; `hidden` ohne Zugriff auf die Akte. */
export type PartnerDocument = PickedDocument | { id: string; hidden: true };

const pickable = (doc: PartnerDocument | null): PickedDocument | null => (doc === null ? null : 'hidden' in doc ? { id: doc.id, number: null, subject: '', phase: 'issued' } : doc);


export function PartnerDetail({ partner, notices, payments, registerDocument, agreementDocument, canWrite }: { partner: PartnerView; notices: PartnerNoticeView[]; payments: PaymentRow[]; registerDocument: PartnerDocument | null; agreementDocument: PartnerDocument | null; canWrite: boolean }) {
  const t = useTranslations('finance.partners.detail');
  const tStatus = useTranslations('finance.partners.status');
  const tBasis = useTranslations('finance.partners.basis');
  const router = useRouter();

  const fmt = useDateFormat();
  const newPaymentFb = useActionFeedback();
  const showNotices = partner.status === 'taxExemptBody' || partner.status === 'foreignBody';

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <ProfileSection partner={partner} documents={{ register: registerDocument, agreement: agreementDocument }} canWrite={canWrite} t={t} tStatus={tStatus} tBasis={tBasis} router={router} />
        <div className="space-y-6">
          {showNotices ? <NoticesSection partnerId={partner.id} abroad={partner.status === 'foreignBody'} notices={notices} canWrite={canWrite} t={t} router={router} /> : null}
          <section className="space-y-3" data-testid="partner-payments">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-[16px] text-ink">{t('payments.title')}</h2>
              {canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  data-testid="partner-new-payment"
                  onClick={async () => {
                    const result = await newPaymentFb.run(() => savePartnerPaymentDraftAction({ partnerId: partner.id, basis: (partner.usualBasis ?? 'transfer58') as Basis, purposeText: '', retroactive: false, positions: [] }));
                    if (result.status !== 'success') return;
                    const data = result.data as { id: string } | undefined;
                    if (data?.id) router.push(`/finance/partners/${partner.id}/payments/${data.id}`);
                  }}
                >
                  {t('payments.new')}
                </Button>
              ) : null}
            </div>
            <RefusalNotice action state={newPaymentFb.state} />
            {payments.length === 0 ? (
              <p className="text-[13px] text-muted-ink">{t('payments.empty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('payments.columns.number')}</TableHead>
                    <TableHead className="text-right">{t('payments.columns.amount')}</TableHead>
                    <TableHead>{t('payments.columns.state')}</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">{t('payments.columns.date')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id} data-testid={`payment-row-${p.id}`}>
                      <TableCell className="whitespace-normal">
                        <Link href={`/finance/partners/${partner.id}/payments/${p.id}`} className="font-mono text-ink underline-offset-2 hover:underline">
                          {p.number ?? (p.purposeText || t('payments.new'))}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatEuro(p.totalCents)}</TableCell>
                      <TableCell className="whitespace-normal text-ink-2">
                        {t(`payments.state.${paymentStateKey(p)}`)}
                        {p.readyToAcknowledge ? (
                          <>
                            {' '}
                            <StatusBadge tone="warning">{t('payments.readyToAcknowledge')}</StatusBadge>
                          </>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{fmt.date(p.date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function ProfileSection({ partner, documents, canWrite, t, tStatus, tBasis, router }: { partner: PartnerView; documents: { register: PartnerDocument | null; agreement: PartnerDocument | null }; canWrite: boolean; t: ReturnType<typeof useTranslations>; tStatus: ReturnType<typeof useTranslations>; tBasis: ReturnType<typeof useTranslations>; router: ReturnType<typeof useRouter> }) {
  const [status, setStatus] = useState<Status>(partner.status);
  const [usualBasis, setUsualBasis] = useState<Basis>((partner.usualBasis ?? 'transfer58') as Basis);
  const [usualProofMonths, setUsualProofMonths] = useState(partner.usualProofMonths);
  const [note, setNote] = useState(partner.note ?? '');
  const [registerDocument, setRegisterDocument] = useState<PickedDocument | null>(pickable(documents.register));
  const [agreementDocument, setAgreementDocument] = useState<PickedDocument | null>(pickable(documents.agreement));
  const [pending, setPending] = useState(false);
  const saveFb = useActionFeedback();
  const tList = useTranslations('finance.partners.list');

  const derived = status !== 'foreignBody';

  const save = async () => {
    setPending(true);
    const result = await saveFb.run(() => savePartnerProfileAction({
      id: partner.id,
      contactId: partner.contactId,
      status,
      usualBasis: derived ? undefined : usualBasis,
      usualProofMonths,
      note: note || null,
      registerDocumentId: registerDocument?.id ?? null,
      agreementDocumentId: agreementDocument?.id ?? null,
      isActive: partner.isActive,
    }), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-4" data-testid="partner-profile">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[16px] text-ink">{t('profile.title')}</h2>
        <div className="flex items-center gap-2">
          {!partner.isActive ? <StatusBadge tone="neutral">{tList('inactive')}</StatusBadge> : null}
        </div>
      </div>

      {/* Rechtsform als Anzeige in der Zeile des Abschnitts, kein Feld (Entscheidung zum Inventar § E). */}
      <section>
        <h3 className="text-[15px] font-semibold">
          {t('profile.sections.classification')}
          <span className="font-normal text-ink-2" data-testid="partner-legal-form">
            {' · '}
            {partner.contactLegalForm ?? (
              <Link href={`/contacts/${partner.contactId}`} className="underline underline-offset-2">
                {t('profile.legalFormNone')}
              </Link>
            )}
          </span>
        </h3>
        <div className="mt-3">
          <FormGrid>
            <FormField id="partner-status" label={t('profile.status')} required>
              <Select id="partner-status" value={status} disabled={!canWrite} onChange={(e) => setStatus(e.target.value as Status)}>
                {(['taxExemptBody', 'foreignBody', 'publicBody', 'agent'] as const).map((s) => (
                  <option key={s} value={s}>
                    {tStatus(s)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="partner-proof-months" label={t('profile.usualProofMonths')} size="s">
              <Select id="partner-proof-months" value={String(usualProofMonths)} disabled={!canWrite} onChange={(e) => setUsualProofMonths(Number(e.target.value))}>
                {PROOF_MONTHS.map((n) => (
                  <option key={n} value={n}>
                    {t('profile.months', { count: n })}
                  </option>
                ))}
              </Select>
            </FormField>
            {derived ? (
              <FormCell size="full" className="space-y-1">
                <p className="text-[13px] font-semibold text-ink">{t('profile.usualBasis')}</p>
                <p className="text-[14px] text-ink-2" data-testid="partner-basis-derived">
                  {tBasis(status === 'agent' ? 'agent57' : 'transfer58')} <span className="text-[12px] text-muted-ink">({t('profile.usualBasisDerived')})</span>
                </p>
              </FormCell>
            ) : canWrite ? (
              <FormCell size="full" className="space-y-1.5" data-testid="partner-basis-cards">
                <ChoiceCards
                  mode="choice"
                  name="partner-usual-basis"
                  legend={t('profile.basisQuestion')}
                  value={usualBasis}
                  onSelect={(v) => setUsualBasis(v as Basis)}
                  options={(['transfer58', 'agent57'] as const).map((b) => ({ value: b, label: t(`profile.basisCards.${b}`), description: tBasis(b) }))}
                />
                <p className="text-[12px] text-muted-ink">{t('profile.basisHint')}</p>
              </FormCell>
            ) : (
              <FormCell size="full" className="space-y-1">
                <p className="text-[13px] font-semibold text-ink">{t('profile.basisQuestion')}</p>
                <p className="text-[14px] text-ink-2">{t(`profile.basisCards.${usualBasis}`)}</p>
              </FormCell>
            )}
          </FormGrid>
        </div>
      </section>
      <section className="mt-5 border-t border-line pt-5">
        <h3 className="text-[15px] font-semibold">{t('profile.sections.documents')}</h3>
        <div className="mt-3">
          <FormGrid>
            {canWrite ? (
              <>
                <FormCell size="m">
                  <DocumentPicker id="partner-register-doc" name="registerDocumentId" label={t('profile.registerDocument')} value={registerDocument} onChange={setRegisterDocument} />
                </FormCell>
                <FormCell size="m">
                  <DocumentPicker id="partner-agreement-doc" name="agreementDocumentId" label={t('profile.agreementDocument')} value={agreementDocument} onChange={setAgreementDocument} />
                </FormCell>
              </>
            ) : (
              <>
                <FormCell as="dl" size="m">
                  <DocumentLine label={t('profile.registerDocument')} doc={documents.register} t={t} />
                </FormCell>
                <FormCell as="dl" size="m">
                  <DocumentLine label={t('profile.agreementDocument')} doc={documents.agreement} t={t} />
                </FormCell>
              </>
            )}
            <FormField id="partner-note" label={t('profile.note')} size="l">
              <Textarea id="partner-note" rows={2} value={note} disabled={!canWrite} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </FormGrid>
        </div>
      </section>
      <RefusalNotice state={saveFb.state} />
      {canWrite ? (
        <div className="flex items-center justify-end">
          <Button type="button" disabled={pending} onClick={() => void save()} data-testid="partner-profile-save">
            {t('profile.save')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

type NoticeKindChoice = 'section60a' | 'exemptionNotice' | 'corporateTaxNoticeAttachment' | 'recognitionAbroad';

/**
 * Bescheide des Partners (Artboard 4a, Entscheidung 3): Tabelle Art · gültig
 * bis · Nachweis erhalten am. Bei einem Partner im Ausland die „Anerkennung im
 * Sitzland“ mit eigenem „gültig bis“ — sie trägt keine Prüfung am Zahlungstag.
 */
function NoticesSection({ partnerId, abroad, notices, canWrite, t, router }: { partnerId: string; abroad: boolean; notices: PartnerNoticeView[]; canWrite: boolean; t: ReturnType<typeof useTranslations>; router: ReturnType<typeof useRouter> }) {
  const tKind = useTranslations('finance.donations.noticeKind');
  const fmt = useDateFormat();
  const kinds: NoticeKindChoice[] = abroad ? ['recognitionAbroad'] : ['exemptionNotice', 'corporateTaxNoticeAttachment', 'section60a'];
  const kindLabel = (k: string) => (k === 'recognitionAbroad' ? t('notices.kindAbroad') : tKind(k));
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<NoticeKindChoice>(kinds[0]!);
  const [noticeDate, setNoticeDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidNote, setVoidNote] = useState('');
  const [pending, setPending] = useState(false);
  const saveFb = useActionFeedback();

  const save = async () => {
    if (!document) return;
    setPending(true);
    const result = await saveFb.run(() => savePartnerNoticeAction({ partnerId, kind, noticeDate, validUntil: kind === 'recognitionAbroad' ? validUntil || undefined : undefined, receivedOn: receivedOn || undefined, documentId: document.id }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    setAdding(false);
    setDocument(null);
    setNoticeDate('');
    setValidUntil('');
    setReceivedOn('');
    router.refresh();
  };

  return (
    <section className="space-y-3" data-testid="partner-notices">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-[16px] text-ink">{t('notices.title')}</h2>
        {canWrite && !adding ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)} data-testid="notice-add-trigger">
            {t('notices.new')}
          </Button>
        ) : null}
      </div>
      {adding ? (
        <div className="space-y-3 rounded-md border border-line bg-surface p-3" data-testid="notice-form">
          <FormGrid>
            <FormField id="notice-kind" label={t('notices.kind')}>
              <Select id="notice-kind" value={kind} onChange={(e) => setKind(e.target.value as NoticeKindChoice)}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="notice-date" label={t('notices.noticeDate')} required size="s">
              <Input id="notice-date" type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
            </FormField>
            {kind === 'recognitionAbroad' ? (
              <FormField id="notice-valid-until" label={t('notices.validUntil')} required size="s">
                <Input id="notice-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </FormField>
            ) : null}
            <FormField id="notice-received" label={t('notices.receivedOn')} size="s">
              <Input id="notice-received" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </FormField>
            <FormCell size="m">
              <DocumentPicker id="notice-document" name="documentId" label={t('notices.document')} value={document} onChange={setDocument} required />
            </FormCell>
          </FormGrid>
          <RefusalNotice state={saveFb.state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              {t('notices.cancel')}
            </Button>
            <Button type="button" disabled={!document || !noticeDate || (kind === 'recognitionAbroad' && !validUntil) || pending} onClick={() => void save()}>
              {t('notices.save')}
            </Button>
          </div>
        </div>
      ) : null}
      {notices.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('notices.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('notices.kind')}</TableHead>
              <TableHead>{t('notices.validUntil')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('notices.receivedColumn')}</TableHead>
              <TableHead>{t('notices.stateColumn')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {notices.map((n) => (
              <TableRow key={n.id} data-testid={`notice-row-${n.id}`}>
                <TableCell className="whitespace-normal">
                  {kindLabel(n.kind)}
                  <span className="block text-[12px] text-muted-ink">{t('notices.dated', { date: fmt.date(n.noticeDate) })}</span>
                  {canWrite && n.state !== 'voided' ? (
                    <Button type="button" variant="link" size="xs" className="mt-1 flex px-0" onClick={() => setVoiding(n.id)}>
                      {t('notices.voidItem')}
                    </Button>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{fmt.date(n.validUntil)}</TableCell>
                <TableCell className="hidden font-mono tabular-nums sm:table-cell">{fmt.date(n.receivedOn)}</TableCell>
                <TableCell className="whitespace-normal text-ink-2">{t(`notices.state.${n.state}`)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {/* Unumkehrbar: Rückfrage mit der Folge als Beschreibung und der Begründung als Feld (Spec Seitenkopf § 3.6). */}
      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (open) return;
          setVoiding(null);
          setVoidNote('');
        }}
        title={t('notices.voidTitle')}
        description={t('notices.voidDescription')}
        confirmLabel={t('notices.void')}
        destructive
        confirmDisabled={!voidNote.trim()}
        action={async () => {
          if (!voiding) return { status: 'idle' };
          const result = await voidPartnerNoticeAction(voiding, voidNote);
          if (result.status === 'success') {
            setVoidNote('');
            router.refresh();
          }
          return result;
        }}
      >
        <FormField id="partner-notice-void-note" label={t('notices.voidNote')} required>
          <Textarea id="partner-notice-void-note" rows={2} value={voidNote} onChange={(e) => setVoidNote(e.target.value)} />
        </FormField>
      </ConfirmDialog>
    </section>
  );
}

/** Lesende Zeile für ein hinterlegtes Dokument (D5): Nummer und Betreff mit Link in die Akte, sofern sie es zeigt. */
function DocumentLine({ label, doc, t }: { label: string; doc: PartnerDocument | null; t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="space-y-1">
      <dt className="text-[13px] font-semibold text-ink">{label}</dt>
      <dd className="text-[14px] text-ink-2">
        {doc === null ? (
          t('profile.documentNone')
        ) : 'hidden' in doc ? (
          t('profile.documentHidden')
        ) : (
          <Link href={`/dms/${doc.id}`} className="underline underline-offset-2">
            {doc.number ? <span className="font-mono">{doc.number}</span> : null}
            {doc.number ? ' · ' : null}
            {doc.subject}
          </Link>
        )}
      </dd>
    </div>
  );
}
