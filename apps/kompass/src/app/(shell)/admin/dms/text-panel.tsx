'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { reindexAllDocumentsAction, updateOcrLanguagesAction } from './actions';
import { Select } from '@/components/ui/select';

export interface TextPanelProps {
  currentLanguages: string;
  availableLanguages: string[] | null;
  openCount: number;
  canManageSettings: boolean;
}

export function TextPanel({
  currentLanguages,
  availableLanguages,
  openCount,
  canManageSettings,
}: TextPanelProps) {
  const t = useTranslations('dms.admin');
  const tDms = useTranslations('dms');

  const [selectedLangs, setSelectedLangs] = useState<string[]>(() =>
    currentLanguages.split('+').map((s) => s.trim()).filter(Boolean),
  );
  const [savingLangs, startSaveTransition] = useTransition();
  const [reindexing, startReindexTransition] = useTransition();
  const langFb = useActionFeedback();
  const reindexFb = useActionFeedback();

  const handleAddLanguage = (lang: string) => {
    if (!selectedLangs.includes(lang)) {
      setSelectedLangs([...selectedLangs, lang]);
    }
  };

  const handleRemoveLanguage = (lang: string) => {
    if (selectedLangs.length <= 1) return;
    setSelectedLangs(selectedLangs.filter((l) => l !== lang));
  };

  const handleSaveLanguages = () => {
    startSaveTransition(async () => {
      await langFb.run(() => updateOcrLanguagesAction(selectedLangs.join('+')), { retry: handleSaveLanguages });
    });
  };

  const handleReindex = () => {
    startReindexTransition(async () => {
      await reindexFb.run(() => reindexAllDocumentsAction(), { retry: handleReindex });
    });
  };

  const hasLanguageChanges = selectedLangs.join('+') !== currentLanguages;

  return (
    <section className="space-y-6 rounded-md border border-line bg-surface p-5">
      <div>
        <p className="text-[13px] text-ink-2">{t('textPanel.description')}</p>
      </div>

      {/* Sprachen der Texterkennung */}
      <div className="space-y-3 border-t border-line-2 pt-4">
        <h4 className="text-[14px] font-semibold text-ink">{t('textPanel.languages')}</h4>
        {availableLanguages === null ? (
          <p className="text-[13px] text-muted-ink">{tDms('text.unavailableHint')}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {selectedLangs.map((lang) => (
                <span
                  key={lang}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-2.5 py-1 font-mono text-[13px] font-medium text-brand-ink"
                >
                  {lang}
                  {canManageSettings && selectedLangs.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveLanguage(lang)}
                      className="text-muted-ink hover:text-error"
                      aria-label={t('removeLanguage', { lang })}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))}
            </div>

            {canManageSettings ? (
              <div className="space-y-2">
              <RefusalNotice action state={langFb.state} />
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleAddLanguage(e.target.value);
                  }}
                  className="w-auto font-mono"
                  aria-label={t('textPanel.languages')}
                >
                  <option value="">{t('textPanel.addLanguage')}</option>
                  {availableLanguages
                    .filter((l) => !selectedLangs.includes(l))
                    .map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                </Select>

                {hasLanguageChanges ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingLangs}
                    onClick={handleSaveLanguages}
                  >
                    {t('save')}
                  </Button>
                ) : null}
              </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Alles neu lesen */}
      <div className="space-y-2 border-t border-line-2 pt-4">
        <RefusalNotice action state={reindexFb.state} />
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={reindexing}
            onClick={handleReindex}
          >
            {t('textPanel.reindex')}
          </Button>
          {openCount > 0 ? (
            <span className="text-[13px] text-muted-ink">
              {t('textPanel.open', { count: openCount })}
            </span>
          ) : null}
        </div>
        </div>
      </div>
    </section>
  );
}
