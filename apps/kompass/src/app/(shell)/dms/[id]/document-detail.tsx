'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteDocumentAction, deleteDraftAction, rereadDocumentAction, voidDocumentAction } from '../actions';
import { FileDialog } from './file-dialog';
import { FolderPanel } from './folder-panel';
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
  };
  followUps: FollowUpView[];
  notes: NoteView[];
  users: { id: string; name: string }[];
  channels: { key: string; label: string }[];
  today: string;
  canSeeFollowUps: boolean;
  canManageFollowUps: boolean;
  folders: string[];
  animals: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  canCreateContact: boolean;
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
  retentionInfo,
  permissions,
}: DocumentDetailProps) {
  const t = useTranslations('dms');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [withReplacement, setWithReplacement] = useState(false);

  useEffect(() => {
    if (doc.textStatus !== 'pending' && doc.textStatus !== 'running') return;
    const interval = setInterval(() => {
      router.refresh();
    }, 1000);
    return () => clearInterval(interval);
  }, [doc.textStatus, router]);

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          {/* Der Rückweg steht am `PageHeader`, wie auf jeder Seite abseits der Navigation. */}
          {doc.number ? (
            <span className="font-mono text-[16px] font-bold text-ink">{doc.number}</span>
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
              {permissions.canDeleteDraft ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                    className="text-error hover:bg-error-bg hover:text-error"
                  >
                    {t('deleteDraft')}
                  </Button>
                  <ConfirmDialog
                    open={deleteOpen}
                    onOpenChange={setDeleteOpen}
                    title={t('deleteDraftConfirmTitle')}
                    description={t('deleteDraftConfirmDescription')}
                    confirmLabel={t('deleteDraftConfirmSubmit')}
                    destructive
                    action={() => deleteDraftAction(doc.id)}
                  />
                </>
              ) : null}
            </>
          ) : (
            <>
              <a
                href={`/dms/${doc.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('openPdf')}
              </a>
              {doc.status !== 'voided' && permissions.canVoid ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setVoidOpen(true)}
                    className="border-error text-error hover:bg-error-bg hover:text-error"
                  >
                    {t('void')}
                  </Button>
                  <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
                    <DialogContent className="bg-surface shadow-md">
                      <DialogTitle className="font-heading text-[19px]">{t('voidConfirmTitle')}</DialogTitle>
                      <DialogDescription className="text-[14px] text-ink-2">
                        {t('voidConfirmDescription')}
                      </DialogDescription>
                      <div className="space-y-1.5 py-2">
                        <Label htmlFor="voidReason">{t('fields.voidReason')}</Label>
                        <Input
                          id="voidReason"
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          placeholder={t('fields.voidReasonPlaceholder')}
                        />
                      </div>
                      {permissions.canEdit ? (
                        <label className="flex items-center gap-2 py-1 text-[13px] text-ink-2">
                          <Checkbox checked={withReplacement} onCheckedChange={(next) => setWithReplacement(next === true)} />
                          {t('voidWithReplacement')}
                        </label>
                      ) : null}
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setVoidOpen(false)}>
                          {tCommon('cancel')}
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!voidReason.trim()}
                          onClick={async () => {
                            await voidDocumentAction(doc.id, voidReason, withReplacement);
                            setVoidOpen(false);
                          }}
                        >
                          {t('voidConfirmSubmit')}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Metadata & Details Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 columns: PDF preview */}
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-md border border-line bg-surface shadow-xs">
            <iframe
              src={doc.phase === 'draft' ? `/dms/${doc.id}/preview` : `/dms/${doc.id}/file`}
              className="h-[720px] w-full border-none"
              title={doc.subject}
            />
          </div>

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
                <dd className="font-medium text-ink">{doc.documentDate}</dd>
              </div>
              <div>
                <FolderPanel documentId={doc.id} folder={doc.folder} folders={folders} canEdit={permissions.canEdit} />
              </div>
              <div>
                <dt className="text-muted-ink">{t('columns.direction')}</dt>
                <dd className="font-medium text-ink">{t(`directions.${doc.direction}`)}</dd>
              </div>
              {doc.status === 'voided' ? (
                <div className="rounded-md bg-error-bg p-3 text-error">
                  <dt className="font-semibold">{t('voidReasonTitle')}</dt>
                  <dd className="mt-1">{doc.voidReason}</dd>
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

          {/* Retention panel */}
          {retentionInfo ? (
            <section className="rounded-md border border-line bg-surface p-5 shadow-xs">
              <h3 className="mb-3 text-[15px] font-semibold text-ink">{t('retentionTitle')}</h3>
              <p className="text-[13px] text-ink-2">
                {retentionInfo.retentionClass === 'permanent'
                  ? t('retentionPermanent')
                  : retentionInfo.until
                    ? t('retentionUntil', { date: retentionInfo.until })
                    : t('retentionRunning')}
              </p>

              {/* Die Frist ist abgelaufen — ein Mensch bestätigt die Löschung (Prinzip 3). */}
              {permissions.canManage ? (
                <div className="mt-4 flex flex-col gap-2 border-t border-line-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!retentionInfo.due}
                    onClick={() => setPurgeOpen(true)}
                    className="self-start border-error text-error hover:bg-error-bg hover:text-error"
                  >
                    {t('deleteDocument')}
                  </Button>
                  {!retentionInfo.due ? (
                    <span className="text-[12px] text-muted-ink">{t('deleteDocumentBlocked')}</span>
                  ) : null}
                  <ConfirmDialog
                    open={purgeOpen}
                    onOpenChange={setPurgeOpen}
                    title={t('deleteDocumentConfirmTitle')}
                    description={t('deleteDocumentConfirmDescription')}
                    confirmLabel={t('deleteDocumentConfirmSubmit')}
                    destructive
                    action={() => deleteDocumentAction(doc.id)}
                  />
                </div>
              ) : null}
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
                        ? format.dateTime(new Date(doc.textExtractedAt), { dateStyle: 'medium', timeStyle: 'short' })
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
        </div>
      </div>
    </div>
  );
}

function RereadButton({ documentId }: { documentId: string }) {
  const t = useTranslations('dms');
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        start(async () => {
          const s = await rereadDocumentAction(documentId);
          if (s.status === 'error') {
            toast.error(s.message);
          } else if (s.status === 'success' && s.message) {
            toast.success(s.message);
          }
        });
      }}
    >
      {t('text.reread')}
    </Button>
  );
}

