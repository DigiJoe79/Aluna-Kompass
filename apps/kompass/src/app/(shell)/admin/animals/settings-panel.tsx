'use client';

import type { PhotoFrame } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveAnimalSettingsAction } from './actions';

/** Die üblichen Formate; ein anderes, das per MCP gesetzt wurde, steht zusätzlich zur Wahl. */
const ASPECTS = ['4:5', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];

type Values = { frame: PhotoFrame; profileUrl: string };

/** Einstellungen des Tiermoduls als eine Karte mit zwei Abschnitten (MUSTER E). */
export function AnimalSettingsPanel({ initial, canManage }: { initial: Values; canManage: boolean }) {
  const t = useTranslations('animals.admin');
  const c = useTranslations('common');
  const [values, setValues] = useState(initial);
  const [pending, start] = useTransition();
  const feedback = useActionFeedback();
  const frame = values.frame;
  const setFrame = (next: PhotoFrame) => setValues({ ...values, frame: next });
  const [w, h] = frame.aspect.split(':').map(Number);
  const changed = (JSON.stringify(frame) !== JSON.stringify(initial.frame) ? 1 : 0) + (values.profileUrl !== initial.profileUrl ? 1 : 0);
  const percent = (value: string) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  // Die Adresse ist ein einzelner Wert: Ihr Prüffehler kommt ohne Pfad und steht am Feld; alles andere über der Leiste (MUSTER A).
  const urlError = feedback.state.status === 'error' ? feedback.state.fieldErrors[''] : undefined;
  return (
    <section aria-label={t('title')} className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="p-5">
        <section>
          <h3 className="text-[15px] font-semibold">{t('frame.title')}</h3>
          <p className="mt-1 text-[13px] text-ink-2">{t('frame.intro')}</p>
          <div className="mt-3">
            <FormGrid>
              <FormField id="photo-aspect" label={t('frame.aspect')} hint={t('frame.aspectHint')} size="s">
                <Select id="photo-aspect" value={frame.aspect} disabled={!canManage} onChange={(e) => setFrame({ ...frame, aspect: e.target.value })}>
                  {(ASPECTS.includes(frame.aspect) ? ASPECTS : [frame.aspect, ...ASPECTS]).map((a) => (
                    <option key={a} value={a}>{t.has(`frame.aspects.${a.replace(':', 'x')}`) ? t(`frame.aspects.${a.replace(':', 'x')}`) : a}</option>
                  ))}
                </Select>
              </FormField>
              <FormField id="photo-focus-x" label={t('frame.focusX')} hint={t('frame.focusXHint')} size="s">
                <Input id="photo-focus-x" type="number" min={0} max={100} value={frame.focusX} disabled={!canManage} onChange={(e) => setFrame({ ...frame, focusX: percent(e.target.value) })} className="font-mono" />
              </FormField>
              <FormField id="photo-focus-y" label={t('frame.focusY')} hint={t('frame.focusYHint')} size="s">
                <Input id="photo-focus-y" type="number" min={0} max={100} value={frame.focusY} disabled={!canManage} onChange={(e) => setFrame({ ...frame, focusY: percent(e.target.value) })} className="font-mono" />
              </FormField>
              {/* Eine Skizze des Rahmens, damit man das Format sieht, ohne einen Hund zu öffnen; die vierte Zelle der Zeile. */}
              <div aria-hidden className="relative w-28 rounded-sm border border-line-strong bg-surface-2" style={{ aspectRatio: `${w} / ${h}` }}>
                <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" style={{ left: `${frame.focusX}%`, top: `${frame.focusY}%` }} />
              </div>
            </FormGrid>
          </div>
        </section>
        <section className="mt-5 border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold">{t('profileUrl.title')}</h3>
          <p className="mt-1 text-[13px] text-ink-2">{t('profileUrl.intro')}</p>
          <div className="mt-3">
            <FormGrid>
              <FormField id="profile-url" label={t('profileUrl.label')} hint={t('profileUrl.hint')} error={urlError} size="l">
                <Input id="profile-url" value={values.profileUrl} disabled={!canManage} onChange={(e) => setValues({ ...values, profileUrl: e.target.value })} className="font-mono" />
              </FormField>
            </FormGrid>
          </div>
        </section>
      </div>
      {canManage ? (
        <FormActionBar
          count={changed}
          pending={pending}
          saveLabel={c('save')}
          state={withUnplacedFieldErrors(feedback.state, [''])}
          onDiscard={() => {
            setValues(initial);
            feedback.reset();
          }}
          onSave={() => start(async () => void (await feedback.run(() => saveAnimalSettingsAction(values), { retry: () => undefined })))}
        />
      ) : null}
    </section>
  );
}
