'use client';

import type { MeetingContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ruleSource } from '@/lib/governance/majority-text';
import { ITEM_KINDS } from '../agenda-item-dialog';
import { recordFloorMotionAction } from './actions';

const STRICT = ['statute', 'purpose', 'dissolution'];

/**
 * „Antrag aus der Versammlung …“ (Board 1f, `md`): gestellt von, Antrag, Art. Der Antrag kommt hinter den aktuellen
 * Punkt (Entscheidung 3) und beginnt mit der Abstimmung über die Aufnahme.
 */
export function FloorMotionDialog({ meetingId, afterItemId, people, context, onClose, onRecorded }: { meetingId: string; afterItemId: string | null; people: { id: string; name: string }[]; context: MeetingContext; onClose: () => void; onRecorded: (motionId: string) => void }) {
  const t = useTranslations('governance.live.floor');
  const tl = useTranslations('governance.live.lateMotion');
  const tk = useTranslations('governance.agendaKinds');
  const tm = useTranslations('governance.majority');
  const router = useRouter();
  const [by, setBy] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<string>('simple');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const announce = (context.rules.announceRequired as string[]).includes(kind);
  const strictRule = (context.rules.majorityByKind as Record<string, (typeof context.rules.lateMotion) | undefined>)[kind];
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => recordFloorMotionAction({ meetingId, submittedByContactId: by || null, text, kind, ...(afterItemId ? { afterItemId } : {}) }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    const motionId = (result.data as { id?: string } | undefined)?.id;
    onClose();
    router.refresh();
    if (motionId) onRecorded(motionId);
  };
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              <FormField id="floor-by" label={t('by')} required error={errors.submittedByContactId}>
                <Select id="floor-by" value={by} onChange={(e) => setBy(e.target.value)}>
                  <option value="">{t('choose')}</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField id="floor-kind" label={t('kind')} required error={errors.kind}>
                <Select id="floor-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>{tk(k)}</option>
                  ))}
                </Select>
              </FormField>
              <FormField id="floor-text" label={t('text')} required size="full" error={errors.text}>
                <Textarea id="floor-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
              </FormField>
            </FormGrid>
            {announce ? (
              <div className="mt-3">
                <Notice level="warn">{STRICT.includes(kind) && strictRule ? tl('notAnnouncedStrict', { kind: tk(kind), source: ruleSource(tm, strictRule) }) : tl('notAnnounced')}</Notice>
              </div>
            ) : null}
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" mode="create" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} saveLabel={t('submit')} testId="floor-motion-footer" />
      </DialogContent>
    </Dialog>
  );
}
