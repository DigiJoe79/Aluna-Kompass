'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { AllocationLineView } from '@kompass/module-finance';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatEuro } from '@/lib/finance/amount';
import { changesOf, correctionPath, selectableLines, type CorrectableLine } from '@/lib/finance/correction';
import { VoidForm } from '@/app/(shell)/finance/donations/void-dialog';
import { requestCorrectionAction, uploadCorrectionProofAction } from '../actions';
import { useOpenReverse } from './entry-actions';

type PartyGroup = { contact: boolean; project: boolean; purpose: boolean; abroad: boolean };

export interface CorrectDialogEntry {
  id: string;
  allocationLines: Pick<AllocationLineView, 'id' | 'categoryId' | 'amountCents' | 'contactId' | 'projectId' | 'purposeId' | 'abroad' | 'pendingCorrectionId'>[];
}

export function CorrectDialog({
  entry,
  purposes,
  projects,
  contactNames,
  categoryNames,
  confirmations = {},
  canVoidConfirmation = false,
}: {
  entry: CorrectDialogEntry;
  purposes: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  contactNames: Map<string, string>;
  categoryNames: Map<string, string>;
  /** Gültige Bestätigungen je Zuordnungszeile (F6a Task 7) — auf einer solchen Zeile führt der Dialog den Dreischritt. */
  confirmations?: Record<string, { id: string; number: string }>;
  canVoidConfirmation?: boolean;
}) {
  const t = useTranslations('finance.entryView.correct');
  const openReverse = useOpenReverse();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pickedLineId, setPickedLineId] = useState<string | null>(null);
  const [party, setParty] = useState<PartyGroup>({ contact: false, project: false, purpose: false, abroad: false });
  const [note, setNote] = useState('');
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [projectId, setProjectId] = useState('');
  const [purposeId, setPurposeId] = useState('');
  const [abroad, setAbroad] = useState(false);
  // F3a-N Task 2: die zwei Lagen, auf die `requestAllocationCorrection` mit einem Konflikt statt einem Feldfehler antwortet.
  const [serverCode, setServerCode] = useState<string | null>(null);
  const [proofDocumentId, setProofDocumentId] = useState<string | null>(null);
  const [proofArchiveOpen, setProofArchiveOpen] = useState(false);
  const [acknowledgeSection153, setAcknowledgeSection153] = useState(false);
  // Befund 7: geht ein Zweck durch die Korrektur ins Minus, fragt der Dienst nach einer Begründung.
  const [purposeDetail, setPurposeDetail] = useState<string | null>(null);
  const [purposeReason, setPurposeReason] = useState('');
  const [voidingConfirmation, setVoidingConfirmation] = useState(false);
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);

  // Bei genau einer Aufteilungszeile entfällt der Auswahlschritt (Task 1).
  const autoPicked = entry.allocationLines.length === 1 ? entry.allocationLines[0]! : null;
  const needsPick = entry.allocationLines.length > 1;
  const pickedLine: CorrectableLine | null = autoPicked ?? entry.allocationLines.find((l) => l.id === pickedLineId) ?? null;
  // Liegt eine gültige Bestätigung auf der Zeile, gibt es erst den Dreischritt: zurücknehmen → korrigieren → neu ausstellen.
  const lineConfirmation = pickedLine ? (confirmations[pickedLine.id] ?? null) : null;
  const selectableIds = new Set(selectableLines(entry.allocationLines).map((l) => l.id));

  const allocationKeys = (Object.keys(party) as (keyof PartyGroup)[]).filter((k) => party[k]);
  // Zahlen (Betrag, Datum, Konto, Kategorie, Umsatzsteuer) korrigiert man nicht hier, sondern über „Zurücknehmen …“ unter
  // „Weitere Aktionen“ (Spec Seitenkopf § 3.5) — der Dialog kennt nur noch das Umbuchen.
  const path = correctionPath({ allocation: allocationKeys, numbers: [] });

  const edited = pickedLine
    ? {
        contactId: party.contact ? (contact?.id ?? null) : pickedLine.contactId,
        projectId: party.project ? (projectId || null) : pickedLine.projectId,
        purposeId: party.purpose ? (purposeId || null) : pickedLine.purposeId,
        abroad: party.abroad ? abroad : pickedLine.abroad,
      }
    : null;
  const changes = pickedLine && edited ? changesOf(pickedLine, edited) : {};
  const nothingChanged = path === 'allocation' && Object.keys(changes).length === 0;

  const close = () => {
    setOpen(false);
    setPickedLineId(null);
    setParty({ contact: false, project: false, purpose: false, abroad: false });
    setNote('');
    setContact(null);
    setProjectId('');
    setPurposeId('');
    setAbroad(false);
    setServerCode(null);
    setProofDocumentId(null);
    setProofArchiveOpen(false);
    setAcknowledgeSection153(false);
    setPurposeDetail(null);
    setPurposeReason('');
    setVoidingConfirmation(false);
    feedback.reset();
  };

  const runCorrection = async (proofId?: string, ack?: boolean) => {
    if (!pickedLine || nothingChanged) return;
    setPending(true);
    const result = await feedback.run(() => requestCorrectionAction(pickedLine.id, changes, note, proofId, ack, purposeDetail && purposeReason.trim() ? purposeReason : undefined), { retry: () => void runCorrection(proofId, ack) });
    setPending(false);
    if (result.status === 'error') {
      // Zwei Lagen reagieren statt zu raten (Task 2): der Dialog bleibt offen, die Eingaben stehen noch da.
      if (result.code === 'purposeGoesNegative') {
        feedback.reset();
        setPurposeDetail(result.detail ?? result.message);
        return;
      }
      if (result.code === 'purposeChangeNeedsProof' || result.code === 'section153Unacknowledged') {
        feedback.reset();
        setServerCode(result.code);
        return;
      }
      return;
    }
    if (result.status === 'success') {
      close();
      router.refresh();
    }
  };

  const submitAllocation = () => void runCorrection(proofDocumentId ?? undefined, acknowledgeSection153 || undefined);

  const uploadProof = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('entryId', entry.id);
    formData.append('file', file);
    const result = await feedback.run(() => uploadCorrectionProofAction(formData), { retry: () => void uploadProof(files) });
    if (result.status !== 'success') return;
    const data = result.data as { documentId: string };
    setProofDocumentId(data.documentId);
    await runCorrection(data.documentId, acknowledgeSection153 || undefined);
  };

  const pickProofFromArchive = async (documentId: string) => {
    setProofDocumentId(documentId);
    setProofArchiveOpen(false);
    await runCorrection(documentId, acknowledgeSection153 || undefined);
  };

  const lineLabel = (line: CorrectableLine & { categoryId?: string; amountCents?: number }): string => {
    const full = entry.allocationLines.find((l) => l.id === line.id);
    if (!full) return line.id;
    const parts = [
      categoryNames.get(full.categoryId) ?? full.categoryId,
      formatEuro(full.amountCents),
      full.contactId ? (contactNames.get(full.contactId) ?? '') : null,
      full.projectId ? (projects.find((p) => p.id === full.projectId)?.name ?? null) : null,
      full.purposeId ? (purposes.find((p) => p.id === full.purposeId)?.name ?? null) : null,
    ].filter((v): v is string => !!v && v.length > 0);
    return parts.join(' · ');
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t('trigger')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent size="lg" className="bg-surface shadow-md">
          <DialogTitle>{t('title')}</DialogTitle>

          {needsPick && !pickedLine ? (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-ink">{t('pickLine.title')}</p>
              <ul className="space-y-1.5">
                {entry.allocationLines.map((line) => {
                  const pending = !selectableIds.has(line.id);
                  return (
                    <li key={line.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setPickedLineId(line.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-sm border border-line px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>{lineLabel(line)}</span>
                        {pending ? <span className="text-[12px] text-muted-ink">{t('pickLine.pending')}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : pickedLine && lineConfirmation ? (
            <div data-testid="correction-three-steps" className="space-y-3">
              <p className="text-[13px] text-ink-2">{t('confirmation.intro', { number: lineConfirmation.number })}</p>
              <ol className="space-y-2 text-[13px]">
                <li className="flex flex-wrap items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-selected font-semibold text-selected-ink">1</span>
                  {canVoidConfirmation ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setVoidingConfirmation(true)}>
                      {t('confirmation.step1', { number: lineConfirmation.number })}
                    </Button>
                  ) : (
                    <span className="font-semibold text-ink">{t('confirmation.step1', { number: lineConfirmation.number })}</span>
                  )}
                </li>
                <li className="flex items-center gap-2 text-ink-2">
                  <span className="flex size-6 items-center justify-center rounded-full border border-line-strong font-semibold">2</span>
                  {t('confirmation.step2')}
                </li>
                <li className="flex items-center gap-2 text-ink-2">
                  <span className="flex size-6 items-center justify-center rounded-full border border-line-strong font-semibold">3</span>
                  {t('confirmation.step3')}
                </li>
              </ol>
              {!canVoidConfirmation ? <p className="text-[12px] text-muted-ink">{t('confirmation.noRight')}</p> : null}
              {voidingConfirmation ? (
                <div className="border-t border-line pt-3">
                  <VoidForm
                    confirmation={{ id: lineConfirmation.id, number: lineConfirmation.number, lineCount: 1, sent: false }}
                    onDone={() => setVoidingConfirmation(false)}
                    onCancel={() => setVoidingConfirmation(false)}
                  />
                </div>
              ) : null}
            </div>
          ) : pickedLine ? (
            <>
              <section>
                <h3 id="correct-group-party" className="text-[15px] font-semibold">{t('groupParty')}</h3>
                {/* Die Haken bilden zusammen eine Diagnose: eine Gruppe über die volle Breite, darin zwei Spalten (Entscheidung zum Inventar). */}
                <div role="group" aria-labelledby="correct-group-party" className="mt-3">
                  <FormGrid>
                    {(['contact', 'project', 'purpose', 'abroad'] as const).map((key) => (
                      <FormField
                        key={key}
                        id={`correct-party-${key}`}
                        label={t(`party.${key}`)}
                        toggle
                        hint={key === 'contact' && pickedLine.contactId ? t('currentlyValue', { value: contactNames.get(pickedLine.contactId) ?? '' }) : undefined}
                      >
                        <Checkbox id={`correct-party-${key}`} checked={party[key]} onCheckedChange={(next) => setParty((p) => ({ ...p, [key]: next === true }))} />
                      </FormField>
                    ))}
                  </FormGrid>
                </div>
              </section>

              <p className="text-[13px] text-ink-2">
                {t.rich('numbersElsewhere', {
                  reverse: (chunks) =>
                    openReverse ? (
                      <Button type="button" variant="link" className="h-auto p-0 text-[13px]" onClick={() => { setOpen(false); openReverse(); }}>
                        {chunks}
                      </Button>
                    ) : (
                      chunks
                    ),
                })}
              </p>

              {path ? <p className="text-[13px] font-semibold text-ink">{t('pathAllocation')}</p> : null}

              {path === 'allocation' ? (
                <section className="space-y-3 border-t border-line pt-5">
                  <h3 className="text-[15px] font-semibold">{t('groupNew')}</h3>
                  <FormGrid>
                    {party.contact ? (
                      <FormCell size="m">
                        <ContactPicker id="correct-contact" name="correctContact" label={t('party.contact')} value={contact} onChange={setContact} />
                      </FormCell>
                    ) : null}
                    {party.project ? (
                      <FormField id="correct-project" label={t('party.project')}>
                        <Select id="correct-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                          <option value="">—</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </Select>
                      </FormField>
                    ) : null}
                    {party.purpose ? (
                      <FormField id="correct-purpose" label={t('party.purpose')}>
                        <Select id="correct-purpose" value={purposeId} onChange={(e) => setPurposeId(e.target.value)}>
                          <option value="">—</option>
                          {purposes.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </Select>
                      </FormField>
                    ) : null}
                    {party.abroad ? (
                      <FormField id="correct-abroad" label={t('party.abroad')} toggle>
                        <Switch id="correct-abroad" checked={abroad} onCheckedChange={(c) => setAbroad(c === true)} />
                      </FormField>
                    ) : null}
                    <FormField id="correct-note" label={t('noteLabel')} required size="l">
                      <Textarea id="correct-note" required value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                    </FormField>
                  </FormGrid>
                  {nothingChanged ? <p className="text-[12px] text-muted-ink">{t('nothingChanged')}</p> : null}

                  {serverCode === 'purposeChangeNeedsProof' ? (
                    <div className="space-y-2 border-t border-line pt-3">
                      <p className="text-[13px] font-semibold text-ink-2">{t('proof.label')}</p>
                      <ReceiptDrop onFiles={(files) => void uploadProof(files)} onPickFromArchive={() => setProofArchiveOpen(true)} />
                      {proofArchiveOpen ? (
                        <FormGrid>
                          <FormCell size="m">
                            <DocumentPicker
                              id="correction-proof-archive"
                              name="correctionProofArchive"
                              label={t('proof.label')}
                              value={null}
                              onChange={(doc) => doc && void pickProofFromArchive(doc.id)}
                            />
                          </FormCell>
                        </FormGrid>
                      ) : null}
                      {proofDocumentId ? <p className="text-[12px] text-success">{t('proof.attached')}</p> : null}
                      <p className="text-[13px] text-ink-2">{t('proof.hint')}</p>
                    </div>
                  ) : null}

                  {purposeDetail ? (
                    <Notice level="warn" reason={{ name: 'purposeReason', value: purposeReason, onChange: setPurposeReason, label: t('purposeReasonLabel') }}>
                      {purposeDetail}
                    </Notice>
                  ) : null}

                  {serverCode === 'section153Unacknowledged' ? (
                    <Notice
                      level="warn"
                      action={
                        <div className="flex items-center gap-2 text-[13px]">
                          <Checkbox id="correct-section153" checked={acknowledgeSection153} onCheckedChange={(next) => setAcknowledgeSection153(next === true)} />
                          <label htmlFor="correct-section153">{t('section153.label')}</label>
                        </div>
                      }
                    >
                      {t('section153.notice')}
                    </Notice>
                  ) : null}
                </section>
              ) : null}

            </>
          ) : null}

          {pickedLine && !lineConfirmation ? (
            <FormActionBar
              placement="dialog"
              cancel={close}
              pending={pending}
              saveLabel={t('submitAllocation')}
              saveDisabled={path === 'allocation' ? note.trim().length === 0 || nothingChanged || (purposeDetail !== null && purposeReason.trim().length === 0) : true}
              onSave={submitAllocation}
              state={feedback.state}
            />
          ) : (
            // Nur „Abbrechen“: Auswahl der Zeile und Dreischritt der Bestätigung haben keine eigene Hauptaktion.
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {t('cancel')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
