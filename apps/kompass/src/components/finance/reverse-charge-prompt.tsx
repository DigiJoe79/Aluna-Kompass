'use client';

import { REVERSE_CHARGE_DECLINE_REASONS, type ReverseChargeDeclineReason } from '@kompass/module-finance/codes';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface ReverseChargePromptProps {
  trigger: 'text' | 'foreignNoTax' | 'foreignVat' | 'germanVatAbroad';
  /** Fertiger Auslösersatz aus der Aufrufstelle (de.json, `reverseChargeTriggerText`). */
  triggerText: string;
  contact: { id: string; name: string; country: string | null } | null;
  /** `remember` nur mit Kontakt (Kästchen „künftig immer so“, vorangekreuzt): auch das Merkmal am Kontakt setzen. */
  onYes: (options: { remember: boolean }) => void;
  onNo: (reason: ReverseChargeDeclineReason, text?: string) => void;
  layout?: 'inline' | 'narrow';
  pending?: boolean;
}

/**
 * Prüffrage § 13b (Board Umsatzsteuer 7a/7b, Freigabe Joe 2026-10-25, Befund 26): im Ton von `Notice hint`, die Frage als
 * Kopf, darunter der Auslösersatz und „Ja, § 13b“ / „Nein, weil …“. „Nein“ klappt vier Gründe in der Fläche auf;
 * „Sonstiges“ verlangt Text. Sperrt nichts — Festschreiben bleibt bedienbar. Unter 360 px Spaltenbreite (oder mit
 * `layout="narrow"`) stehen die Knöpfe untereinander in voller Breite, über eine Container-Abfrage statt Messen.
 */
export function ReverseChargePrompt({ trigger, triggerText, contact, onYes, onNo, layout = 'inline', pending }: ReverseChargePromptProps) {
  const t = useTranslations('finance.reverseChargePrompt');
  const id = useId();
  const [remember, setRemember] = useState(true);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReverseChargeDeclineReason | null>(null);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const narrow = layout === 'narrow';
  const buttons = cn('flex flex-col gap-2', !narrow && '@[360px]:flex-row @[360px]:flex-wrap @[360px]:items-center');
  const fill = cn('w-full', !narrow && '@[360px]:w-auto');

  const save = () => {
    if (!reason) return;
    if (reason === 'other' && text.trim() === '') {
      setInvalid(true);
      return;
    }
    onNo(reason, reason === 'other' ? text.trim() : undefined);
  };

  return (
    <div role="group" aria-label={t('question')} data-testid="reverse-charge-prompt" data-trigger={trigger} className="@container">
      <Notice level="hint" title={t('question')}>
        <div className="space-y-3">
          <p>{triggerText}</p>
          <div className={buttons} data-testid="reverse-charge-buttons">
            <Button type="button" variant="outline" size="sm" className={fill} disabled={pending} onClick={() => onYes({ remember: contact !== null && remember })}>
              {t('yes')}
            </Button>
            <Button type="button" variant="outline" size="sm" className={fill} aria-expanded={open} disabled={pending} onClick={() => setOpen((v) => !v)}>
              {t('no')}
            </Button>
          </div>
          {/* Designer Runde 8, 9c: Das Kästchen setzt das Merkmal am Kontakt, gehört also zum Ja — unter den Knöpfen und
              weg, sobald „Nein, weil …“ aufgeklappt ist; dort sagt der Satz „fragt nicht wieder“ dasselbe für das Nein. */}
          {contact && !open ? (
            <label className="flex items-center gap-2 text-ink" data-testid="reverse-charge-remember">
              <Checkbox checked={remember} disabled={pending} onCheckedChange={(checked) => setRemember(checked === true)} />
              {t('remember', { contact: contact.name })}
            </label>
          ) : null}
          {open ? (
            <div className="space-y-3 border-t border-line pt-3">
              <RadioGroup aria-label={t('reasonsLabel')} value={reason} onValueChange={(v) => { setReason(v as ReverseChargeDeclineReason); setInvalid(false); }}>
                {REVERSE_CHARGE_DECLINE_REASONS.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-ink">
                    <RadioGroupItem value={r} />
                    {t(`reasons.${r}`)}
                  </label>
                ))}
              </RadioGroup>
              {reason === 'other' ? (
                <div className="space-y-1">
                  <label htmlFor={`${id}-text`} className="text-hint font-semibold text-ink">
                    {t('otherText')}
                  </label>
                  <Textarea id={`${id}-text`} value={text} maxLength={200} aria-invalid={invalid || undefined} onChange={(e) => { setText(e.target.value); setInvalid(false); }} rows={2} />
                  {invalid ? <p className="text-hint text-error">{t('otherRequired')}</p> : null}
                </div>
              ) : null}
              <div className={buttons}>
                <p className="flex-1 text-ink-2">
                  {contact ? (
                    <>
                      {t('rememberNo', { contact: contact.name })} <Link href={`/contacts/${contact.id}`}>{t('changeAtContact')}</Link>
                    </>
                  ) : (
                    t('rememberNoWithoutContact')
                  )}
                </p>
                <Button type="button" variant="outline" size="sm" className={fill} disabled={pending || !reason} onClick={save}>
                  {t('save')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Notice>
    </div>
  );
}
