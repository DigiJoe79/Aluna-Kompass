'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { relateDocumentsAction, unrelateDocumentsAction } from '../actions';
import { DocumentPicker } from '../document-picker';
import type { PickedDocument } from '../search-action';

const KINDS = ['repliesTo', 'signedCopyOf', 'replaces', 'attachmentOf'] as const;

export interface RelationView {
  id: string;
  kind: string;
  direction: 'out' | 'in';
  otherId: string;
  otherNumber: string | null;
  otherSubject: string;
  otherPhase: 'draft' | 'issued';
}

/**
 * Was dieses Dokument mit anderen zu tun hat — in beide Richtungen gelesen:
 * „Antwort auf BRF-002“ steht am Eingang, „beantwortet durch BEH-004“ am Brief.
 */
export function RelationsPanel({
  documentId,
  relations,
  canEdit,
}: {
  documentId: string;
  relations: RelationView[];
  canEdit: boolean;
}) {
  const t = useTranslations('dms.relations');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('repliesTo');
  const [other, setOther] = useState<PickedDocument | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    if (!other) return;
    start(async () => {
      const state = await relateDocumentsAction(documentId, other.id, kind);
      if (state.status === 'error') {
        toast.error(state.message);
        return;
      }
      if (state.status === 'success' && state.message) toast.success(state.message);
      setOpen(false);
      setOther(null);
      router.refresh();
    });
  };

  const remove = (relationId: string) =>
    start(async () => {
      const state = await unrelateDocumentsAction(documentId, relationId);
      if (state.status === 'error') toast.error(state.message);
      else if (state.status === 'success' && state.message) toast.success(state.message);
      router.refresh();
    });

  return (
    <section className="rounded-md border border-line bg-surface p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{t('title')}</h3>
        {canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" aria-hidden />
            {t('add')}
          </Button>
        ) : null}
      </div>

      {relations.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      ) : (
        <ul data-testid="document-relations" className="space-y-2 text-[13px] text-ink-2">
          {relations.map((relation) => (
            <li key={relation.id} className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full bg-muted-ink" aria-hidden />
              <span className="flex-1">
                {t(`kinds.${relation.kind}.${relation.direction}`)}{' '}
                <Link href={`/dms/${relation.otherId}`} className="underline underline-offset-2">
                  {relation.otherNumber ?? relation.otherSubject}
                </Link>
              </span>
              {canEdit ? (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => remove(relation.id)}>
                  {t('remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-full sm:max-w-[520px] bg-surface p-6 shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('add')}</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-ink">{t('addDescription')}</DialogDescription>

          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="relation-kind" required>
                {t('kind')}
              </Label>
              <Select id="relation-kind" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kindLabels.${k}`)}
                  </option>
                ))}
              </Select>
            </div>

            <DocumentPicker
              id="relation-document"
              name="relatedDocumentId"
              label={t('document')}
              value={other}
              onChange={setOther}
              exceptId={documentId}
              required
            />
          </div>

          <DialogFooter className="mt-6">
            <span className="mr-auto text-[12px] text-muted-ink">{tCommon('requiredLegend')}</span>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={!other || pending} onClick={submit}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
