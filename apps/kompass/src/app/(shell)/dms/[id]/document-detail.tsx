'use client';

import { pollTextStatus } from '@/lib/poll-text-status';
import { Notice } from '@/components/notice';
import { useDateFormat } from '@/components/date-format-provider';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition, type ReactNode } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { createResponseDraftAction, rereadDocumentAction } from '../actions';
import { FileDialog } from './file-dialog';
import type { FolderEntry } from '@/lib/folder-tree-model';
import { FolderPanel } from './folder-panel';
import { ReclassifyDialog } from './reclassify-dialog';
import { LinksPanel, type ResolvedLink } from './links-panel';
import { DispatchPanel } from './dispatch-panel';
import { FollowUpsPanel, type FollowUpView } from './follow-ups-panel';
import { NotesPanel, type NoteView } from './notes-panel';
import { RelationsPanel, type RelationView } from './relations-panel';

export interface DocumentDetailProps {
  document: {
    id: string;
    number: string | null;
    subject: string;
    typeKey: string;
    typeLabel: string;
    documentDate: string;
    folder: string | null;
    direction: 'incoming' | 'outgoing';
    phase: 'draft' | 'issued';
    status: 'draft' | 'issued' | 'voided';
    voidReason: string | null;
    voidedAt: string | null;
    createdAt: string;
    textStatus: string | null;
    textExtractedAt: string | null;
    textError: string | null;
    links: ResolvedLink[];
    relations: RelationView[];
    sentAt: string | null;
    sentVia: string | null;
    sentNote: string | null;
    /** Nummern vor einem Umklassifizieren, die älteste zuerst. */
    formerNumbers: string[];
    /** Ladestand für den Dialog „Angaben ändern“. */
    updatedAt: string;
  };
  followUps: FollowUpView[];
  notes: NoteView[];
  users: { id: string; name: string }[];
  channels: { key: string; label: string }[];
  today: string;
  canSeeFollowUps: boolean;
  canManageFollowUps: boolean;
  folders: FolderEntry[];
  animals: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  canCreateContact: boolean;
  /** Die aktiven Arten — gefüllt nur, wo umklassifiziert werden darf. */
  reclassifyTypes: { key: string; label: string }[] | null;
  retentionInfo: {
    retentionClass: string;
    until: string | null;
    due: boolean;
  } | null;
  permissions: {
    canFile: boolean;
    canVoid: boolean;
    canDeleteDraft: boolean;
    canEdit: boolean;
    canManage: boolean;
  };
  /**
   * Ob die Datei noch die ist, die festgeschrieben wurde. `altered` heißt: Sie
   * wurde im Datenvolume ausgetauscht — dann wird weder angezeigt noch
   * geöffnet, sondern gewarnt.
   */
  fileState: 'ok' | 'altered' | 'missing' | 'none';
  /** Die Karte „Aus der Rechnung“ des Finanzmoduls (F5b) — unter den Bezügen, nur an Finanzbelegen mit Rechnung im PDF. */
  invoicePanel?: ReactNode;
}

export function DocumentDetail({
  document: doc,
  followUps,
  notes,
  users,
  channels,
  today,
  canSeeFollowUps,
  canManageFollowUps,
  folders,
  animals,
  projects,
  canCreateContact,
  reclassifyTypes,
  retentionInfo,
  permissions,
  fileState,
  invoicePanel,
}: DocumentDetailProps) {
  const t = useTranslations('dms');
  const fmt = useDateFormat();
  const router = useRouter();

  // Die Erkennung fragt /dms/[id]/text-status ab, nicht den Router: Ein
  // `router.refresh()` im Sekundentakt staut sich unter Last in Nexts Warteschlange
  // und hielte Verschieben und Rückgängig auf. Die nächste Abfrage wird erst nach
  // der vorigen geplant (kein Überlapp), der Abstand wächst von 1 s auf 5 s; die
  // Seite erneuert sich genau einmal, wenn der Stand umschlägt (Kette: lib/poll-text-status.ts).
  // Schlägt der Stand nach der Erneuerung wieder auf `pending` um (neu indiziert),
  // ändert sich `doc.textStatus` und der Effekt startet die Kette neu.
  useEffect(() => {
    if (doc.textStatus !== 'pending' && doc.textStatus !== 'running') return;
    return pollTextStatus({
      url: `/dms/${encodeURIComponent(doc.id)}/text-status`,
      onDone: () => router.refresh(),
      onUnauthorized: () => router.refresh(),
    });
  }, [doc.textStatus, doc.id, router]);

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          {/* Der Rückweg steht am `PageHeader`, wie auf jeder Seite abseits der Navigation. */}
          {doc.number ? (
            <span className="font-mono text-[16px] font-bold text-ink">{doc.number}</span>
          ) : null}
          {doc.formerNumbers.length > 0 ? (
            <span className="font-mono text-[12px] text-muted-ink">{t('formerNumbers', { numbers: doc.formerNumbers.join(', ') })}</span>
          ) : null}
          {doc.status === 'voided' ? (
            <StatusBadge tone="error">{t('statuses.voided')}</StatusBadge>
          ) : doc.phase === 'draft' ? (
            <StatusBadge tone="warning">{t('phases.draft')}</StatusBadge>
          ) : (
            <StatusBadge tone="success">{t('phases.issued')}</StatusBadge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {doc.phase === 'draft' ? (
            <>
              <a
                href={`/dms/${doc.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('preview')}
              </a>
              {permissions.canEdit ? (
                <Link href={`/dms/${doc.id}/edit`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  {t('edit')}
                </Link>
              ) : null}
              {permissions.canFile ? <FileDialog documentId={doc.id} /> : null}
            </>
          ) : (
            <>
              {fileState === 'ok' && (
                <a
                  href={`/dms/${doc.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('openPdf')}
                </a>
              )}
              {doc.status !== 'voided' && permissions.canEdit ? <ResponseButton documentId={doc.id} direction={doc.direction} /> : null}
              {reclassifyTypes ? (
                <ReclassifyDialog
                  document={{ id: doc.id, typeKey: doc.typeKey, subject: doc.subject, documentDate: doc.documentDate, updatedAt: doc.updatedAt }}
                  types={reclassifyTypes}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Metadata & Details Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 columns: PDF preview */}
        <div className="lg:col-span-2">
          {fileState === 'altered' || fileState === 'missing' ? (
            /*
             * Kein `<iframe>`: Er zeigte den Meldungstext der Route als rohen
             * Fließtext in einem leeren Rahmen — sichtbar, aber nicht als
             * Befund erkennbar. Und er holte die Datei ein zweites Mal.
             */
            <Notice level="refuse" title={t(fileState === 'altered' ? 'fileAltered.title' : 'fileMissing.title')}>
              {t(fileState === 'altered' ? 'fileAltered.body' : 'fileMissing.body')}
            </Notice>
          ) : (
            <div className="overflow-hidden rounded-md border border-line bg-surface shadow-xs">
              <iframe
                src={doc.phase === 'draft' ? `/dms/${doc.id}/preview` : `/dms/${doc.id}/file`}
                className="h-[720px] w-full border-none"
                title={doc.subject}
              />
            </div>
          )}

          <NotesPanel documentId={doc.id} notes={notes} canEdit={permissions.canEdit} canManage={permissions.canManage} />
        </div>

        {/* Right column: Metadaten & Aufbewahrung */}
        <div className="space-y-6">
          <section className="rounded-md border border-line bg-surface p-5 shadow-xs">
            <h3 className="mb-4 text-[15px] font-semibold text-ink">{t('detailsTitle')}</h3>
            <dl className="space-y-3 text-[13px]">
              <div>
                <dt className="text-muted-ink">{t('columns.subject')}</dt>
                <dd className="font-medium text-ink">{doc.subject}</dd>
              </div>
              <div>
                <dt className="text-muted-ink">{t('columns.type')}</dt>
                <dd className="font-medium text-ink">{doc.typeLabel}</dd>
              </div>
              <div>
                <dt className="text-muted-ink">{t('columns.date')}</dt>
                <dd className="font-medium text-ink">{fmt.date(doc.documentDate)}</dd>
              </div>
              <FolderPanel documentId={doc.id} title={doc.subject} folder={doc.folder} folders={folders} direction={doc.direction} canEdit={permissions.canEdit} />
              <div>
                <dt className="text-muted-ink">{t('columns.direction')}</dt>
                <dd className="font-medium text-ink">{t(`directions.${doc.direction}`)}</dd>
              </div>
              {doc.status === 'voided' ? (
                <div>
                  <dt className="text-muted-ink">{t('voidReasonTitle')}</dt>
                  <dd className="flex flex-wrap items-baseline gap-2 font-medium text-ink">
                    <StatusBadge tone="error">{t('statuses.voided')}</StatusBadge>
                    <span>{doc.voidReason}</span>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          {doc.direction === 'outgoing' && doc.phase === 'issued' ? (
            <DispatchPanel
              documentId={doc.id}
              sentAt={doc.sentAt}
              sentVia={doc.sentVia}
              sentNote={doc.sentNote}
              channels={channels}
              today={today}
              canEdit={permissions.canEdit}
            />
          ) : null}

          {canSeeFollowUps ? (
            <FollowUpsPanel
              documentId={doc.id}
              followUps={followUps}
              users={users}
              today={today}
              canManage={canManageFollowUps}
            />
          ) : null}

          {/* Aufbewahrung: nur die Frist; Löschen steht im Seitenkopf unter „Weitere Aktionen“ (`document-actions.tsx`). */}
          {retentionInfo ? (
            <section className="rounded-md border border-line bg-surface p-5 shadow-xs">
              <h3 className="mb-3 text-[15px] font-semibold text-ink">{t('retentionTitle')}</h3>
              <p className="text-[13px] text-ink-2">
                {retentionInfo.retentionClass === 'permanent'
                  ? t('retentionPermanent')
                  : retentionInfo.until
                    ? t('retentionUntil', { date: fmt.date(retentionInfo.until) })
                    : t('retentionRunning')}
              </p>

            </section>
          ) : null}

          {/* Volltext */}
          {doc.textStatus ? (
            <section className="rounded-md border border-line bg-surface p-5 shadow-xs">
              <h3 className="mb-3 text-[15px] font-semibold text-ink">{t('text.heading')}</h3>
              <p className="text-[13px] text-ink-2">
                {doc.textStatus === 'done'
                  ? t('text.done', {
                      date: doc.textExtractedAt
                        ? fmt.dateTime(doc.textExtractedAt)
                        : '—',
                    })
                  : doc.textStatus === 'failed'
                    ? t('text.failed', { reason: doc.textError ?? '' })
                    : t(`text.${doc.textStatus}`)}
              </p>
              {doc.textStatus === 'unavailable' ? (
                <p className="mt-2 text-[12px] text-muted-ink">{t('text.unavailableHint')}</p>
              ) : null}
              {permissions.canManage ? (
                <div className="mt-4 border-t border-line-2 pt-4">
                  <RereadButton documentId={doc.id} />
                </div>
              ) : null}
            </section>
          ) : null}

          <LinksPanel
            documentId={doc.id}
            links={doc.links}
            canEdit={permissions.canEdit}
            canCreateContact={canCreateContact}
            animals={animals}
            projects={projects}
          />

          <RelationsPanel documentId={doc.id} relations={doc.relations} canEdit={permissions.canEdit} />

          {invoicePanel}
        </div>
      </div>
    </div>
  );
}

/** Genau ein Knopf, beschriftet nach Richtung: eingegangen „Antworten“, ausgehend „Folgeschreiben“ (Befund 0.2.4 Nr. 5). */
function ResponseButton({ documentId, direction }: { documentId: string; direction: 'incoming' | 'outgoing' }) {
  const t = useTranslations('dms');
  const [pending, start] = useTransition();
  const feedback = useActionFeedback();

  return (
    <div className="space-y-2">
    <RefusalNotice action state={feedback.state} />
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        start(async () => {
          // Bei Erfolg leitet die Aktion zur Bearbeiten-Seite des Entwurfs weiter.
          await feedback.run(() => createResponseDraftAction(documentId));
        });
      }}
    >
      {t(`respond.${direction}`)}
    </Button>
    </div>
  );
}

function RereadButton({ documentId }: { documentId: string }) {
  const t = useTranslations('dms');
  const [pending, start] = useTransition();
  const feedback = useActionFeedback();

  return (
    <div className="space-y-2">
      <RefusalNotice action state={feedback.state} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          start(async () => {
            await feedback.run(() => rereadDocumentAction(documentId));
          });
        }}
      >
        {t('text.reread')}
      </Button>
    </div>
  );
}

