'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteDocumentAction, deleteDraftAction, voidDocumentAction } from '../actions';
import { FileDialog } from './file-dialog';

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
    links: {
      entityType: string;
      entityId: string;
      role: string;
      label: string | null;
      href: string | null;
      reason: 'missing' | 'forbidden' | null;
    }[];
  };
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

export function DocumentDetail({ document: doc, retentionInfo, permissions }: DocumentDetailProps) {
  const t = useTranslations('dms');
  const tCommon = useTranslations('common');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <Link href="/dms" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            ← {t('backToList')}
          </Link>
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
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setVoidOpen(false)}>
                          {tCommon('cancel')}
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!voidReason.trim()}
                          onClick={async () => {
                            await voidDocumentAction(doc.id, voidReason);
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
                <dt className="text-muted-ink">{t('columns.folder')}</dt>
                <dd className="font-medium text-ink">
                  {doc.folder ?? (doc.direction === 'incoming' ? t('inbox') : t('noFolder'))}
                </dd>
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

          {/* Links / Bezüge */}
          {doc.links.length > 0 ? (
            <section className="rounded-md border border-line bg-surface p-5 shadow-xs">
              <h3 className="mb-3 text-[15px] font-semibold text-ink">{t('linksTitle')}</h3>
              <ul data-testid="document-links" className="space-y-2 text-[13px] text-ink-2">
                {doc.links.map((link, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-muted-ink" aria-hidden />
                    <span>
                      {link.href && link.label ? (
                        <Link href={link.href} className="underline underline-offset-2">
                          {link.label}
                        </Link>
                      ) : (
                        <span className={link.label ? undefined : 'text-muted-ink'}>
                          {link.label ?? (link.reason === 'forbidden' ? t('linkForbidden') : t('linkMissing'))}
                        </span>
                      )}
                      {' — '}
                      {t.has(`roles.${link.role}`) ? t(`roles.${link.role}`) : link.role}
                      {t.has(`entities.${link.entityType}`) ? ` (${t(`entities.${link.entityType}`)})` : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
