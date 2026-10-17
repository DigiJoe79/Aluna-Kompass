'use client';

import type { LocaleRemovalPreview } from '@kompass/core';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { useLanguageName } from '@/components/forms/localized-field';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { SubmitButton } from '@/components/forms/submit-button';
import { StatusBadge } from '@/components/status-badge';
import { KeyLine } from '@/components/key-line';
import { RowMenu } from '@/components/row-menu';
import { languageOptions } from '@/lib/settings-options';
import { Input } from '@/components/ui/input';
import { idleState, type ActionState } from '@/lib/actions';
import { addLocaleAction, previewLocaleRemovalAction, removeLocaleAction, reorderLocalesAction } from './actions';
import { Section } from '@/components/section';

export function LocalesClient({ locales }: { locales: string[] }) {
  const t = useTranslations('admin.locales');
  const languageName = useLanguageName();
  const uiLocale = useLocale();
  const suggestions = useMemo(() => languageOptions(uiLocale, locales), [uiLocale, locales]);
  const [state, action] = useActionState(addLocaleAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  // `useMemo`, weil `errors` sonst bei jedem Render ein neues Objekt waere und
  // der Effekt unten damit bei jedem Render feuerte statt nur bei einer
  // Zustandsaenderung — der Toast erschiene mehrfach.
  const errors = useMemo(() => (state.status === 'error' ? state.fieldErrors : {}), [state]);

  const [toRemove, setToRemove] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocaleRemovalPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  // „Entfernen“ steht in den Zeilen der Liste: Die Ablehnung steht über der Liste.
  const [removeRefusal, setRemoveRefusal] = useState<ActionState>({ status: 'idle' });

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message ?? '');
      formRef.current?.reset();
    }
  }, [state]);

  const openRemove = async (code: string) => {
    setToRemove(code);
    setRemoveRefusal({ status: 'idle' });
    setLoadingPreview(true);
    setPreview(null);
    const res = await previewLocaleRemovalAction(code);
    if (res.status === 'success') {
      setPreview(res.data as LocaleRemovalPreview);
    } else {
      setRemoveRefusal(res);
      setToRemove(null);
    }
    setLoadingPreview(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <RefusalNotice action state={removeRefusal} />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-b border-line bg-table-head px-6 py-3 text-meta font-semibold text-muted-ink">
          {t('title')} ({locales.length})
        </div>
        <ul role="list" className="divide-y divide-line-2">
          {locales.map((code, index) => (
            <li
              key={code}
              role="listitem"
              className={`flex h-[52px] items-center justify-between px-6 hover:bg-row-hover ${
                index % 2 === 1 ? 'bg-zebra' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Sprachname mit dem Code als Schlüsselzeile darunter (11-2 A4). */}
                <span>
                  <span className="block text-body text-ink">{languageName(code)}</span>
                  <KeyLine>{code}</KeyLine>
                </span>
                {index === 0 ? <StatusBadge tone="neutral">{t('leading')}</StatusBadge> : null}
              </div>
              <div className="flex items-center gap-2">
                <ReorderButtons ids={locales} index={index} action={reorderLocalesAction} />
                {/* Runde 3, 180: Entfernen im ⋯-Menü, die Pfeile bleiben (wie 129). Auch die Leitsprache darf weg; der
                    Dialog nennt dann die neue (`nextLeading`). */}
                <RowMenu
                  name={languageName(code)}
                  items={[{ key: 'remove', label: t('removeItem'), kind: 'delete', hidden: locales.length <= 1, onSelect: () => void openRemove(code) }]}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-line bg-surface p-5">
        <Section title={t('add')}>
        <RefusalNotice state={state} />
        <form ref={formRef} action={action} className="mt-3">
          <FormGrid>
            {/* Vorschläge mit Namen (`Intl.DisplayNames`), ein freier Code bleibt möglich; der Knopf steht in der Zeile
                des Felds, nicht unter dem Hinweis (Runde 3, 180). */}
            <FormField id="code" label={t('code')} hint={t('codeHint')} error={errors.code}>
              <div className="flex items-center gap-2">
                <Input
                  id="code"
                  name="code"
                  list="locale-suggestions"
                  placeholder={t('codePlaceholder')}
                  required
                  pattern="[a-z]{2}(-[a-z]{2})?"
                  autoComplete="off"
                  // Der eingegebene Code ist eine Kennung (Mono), der Platzhalter „z. B. fr“ steht in der Feldschrift (Runde 4, 180).
                  className="font-mono placeholder:font-body"
                />
                <SubmitButton>{t('add')}</SubmitButton>
              </div>
            </FormField>
            <datalist id="locale-suggestions">
              {suggestions.map((o) => (
                <option key={o.value} value={o.value} label={o.label} />
              ))}
            </datalist>
          </FormGrid>
        </form>
        </Section>
      </div>

      <ConfirmDialog
        role="dialog"
        open={toRemove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setToRemove(null);
            setPreview(null);
          }
        }}
        title={t('removeTitle', { language: toRemove ? languageName(toRemove) : '' })}
        description={
          loadingPreview
            ? '...'
            : preview
              ? // Die Leitsprache darf weg; die Folge nennt die Vorschau des Dienstes (11-2 A4, Joe 2026-10-16).
                [t('removeWarning', { count: preview.filled, locale: toRemove ?? '' }), preview.nextLeading ? t('nextLeading', { language: languageName(preview.nextLeading) }) : null].filter(Boolean).join(' ')
              : ''
        }
        confirmLabel={t('removeConfirm')}
        destructive
        confirmDisabled={loadingPreview || preview === null}
        action={async () => {
          if (!toRemove) return idleState;
          const res = await removeLocaleAction(toRemove);
          // Nur bei Erfolg: Eine Ablehnung hält den Dialog offen.
          if (res.status === 'success') {
            setToRemove(null);
            setPreview(null);
          }
          return res;
        }}
      />
    </div>
  );
}
