'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ITEM_KINDS } from '../agenda-item-dialog';

/** „Punkt anlegen“ im Mitlauf ohne Tagesordnung (Board „Leer“, `sm`): Titel und Art, „in der Sitzung ergänzt“. */
export function AddItemDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (input: { title: string; kind: string }) => void }) {
  const t = useTranslations('governance.live.empty');
  const tk = useTranslations('governance.agendaKinds');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>('simple');
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t('dialogTitle')}
      description={t('dialogText')}
      confirmLabel={t('create')}
      action={async () => {
        if (!title.trim()) return { status: 'error', message: t('titleMissing'), fieldErrors: {} };
        onAdd({ title: title.trim(), kind });
        onClose();
        return { status: 'success' };
      }}
    >
      <FormGrid>
        <FormField id="live-item-title" label={t('title')} required size="full">
          <Input id="live-item-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <FormField id="live-item-kind" label={t('kind')} required>
          <Select id="live-item-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>{tk(k)}</option>
            ))}
          </Select>
        </FormField>
      </FormGrid>
    </ConfirmDialog>
  );
}
