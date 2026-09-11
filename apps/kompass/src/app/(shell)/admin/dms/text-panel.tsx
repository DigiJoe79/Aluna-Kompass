'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { reindexAllDocumentsAction, updateOcrLanguagesAction } from './actions';

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
      const res = await updateOcrLanguagesAction(selectedLangs.join('+'));
      if (res.status === 'error') {
        toast.error(res.message);
      } else if (res.status === 'success' && res.message) {
        toast.success(res.message);
      }
    });
  };

  const handleReindex = () => {
    startReindexTransition(async () => {
      const res = await reindexAllDocumentsAction();
      if (res.status === 'error') {
        toast.error(res.message);
      } else if (res.status === 'success' && res.message) {
        toast.success(res.message);
      }
    });
  };

  const hasLanguageChanges = selectedLangs.join('+') !== currentLanguages;

  return (
    <section className="space-y-6 rounded-md border border-line bg-surface p-5">
      <div>
        <h3 className="font-heading text-[18px] text-ink">{t('textPanel.heading')}</h3>
        <p className="text-[13px] text-muted-ink">{t('textPanel.description')}</p>
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
                      aria-label={`${lang} entfernen`}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))}
            </div>

            {canManageSettings ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleAddLanguage(e.target.value);
                  }}
                  className="h-[34px] rounded-md border border-line-strong bg-field px-2.5 font-mono text-[13px] text-ink shadow-xs"
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
                </select>

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
            ) : null}
          </div>
        )}
      </div>

      {/* Alles neu lesen */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 pt-4">
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
    </section>
  );
}
