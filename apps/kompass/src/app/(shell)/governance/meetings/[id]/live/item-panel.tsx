'use client';

import type { AgendaItemView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Empty } from '@/components/empty-value';
import { FormField } from '@/components/forms/form-field';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { SectionHeading } from '@/components/section';
import { Disclosure } from '@/components/ui/disclosure';
import { Textarea } from '@/components/ui/textarea';
import { AUTOSAVE_MS } from '@/lib/autosave';

const STRICT = ['statute', 'purpose', 'dissolution'];

/**
 * Der aktuelle Punkt (Board 1a): Art und TOP als Overline, Titel, Hinweis zur Ankündigung, der Antrag (am Telefon
 * aufklappbar), „Notiz fürs Protokoll“ (speichert von selbst) und darunter, was der Punkt braucht.
 */
export function ItemPanel({ item, kindLabel, strictSource, readOnly, onNote, children }: { item: AgendaItemView; kindLabel: string; strictSource: string; readOnly: boolean; onNote: (note: string) => void; children?: ReactNode }) {
  const t = useTranslations('governance.live.item');
  const [note, setNote] = useState(item.minutesNote ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onNote);
  latest.current = onNote;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const change = (value: string) => {
    setNote(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(value), AUTOSAVE_MS);
  };
  const proposal = item.proposal?.trim() ? <p className="whitespace-pre-line text-body text-ink-2">{item.proposal}</p> : null;
  return (
    <div className="flex flex-col gap-4" data-testid="item-panel">
      <div className="flex flex-col gap-1">
        <Overline>{t('overline', { kind: kindLabel, n: item.position })}</Overline>
        <SectionHeading>{item.title}</SectionHeading>
      </div>
      {item.warnings.includes('notAnnounced') ? <Notice level="warn">{STRICT.includes(item.kind) ? t('notAnnouncedStrict', { kind: kindLabel, source: strictSource }) : t('notAnnounced')}</Notice> : null}
      {proposal ? (
        <>
          <div className="rounded-md bg-surface-2 p-3 max-sm:hidden">{proposal}</div>
          <div className="sm:hidden">
            <Disclosure label={t('proposal')}>{proposal}</Disclosure>
          </div>
        </>
      ) : null}
      {readOnly ? (
        <div className="flex flex-col gap-1">
          <Overline field>{t('note')}</Overline>
          <p className="whitespace-pre-line text-body text-ink-2">{note.trim() ? note : <Empty />}</p>
        </div>
      ) : (
        <FormField id={`note-${item.id}`} label={t('note')} size="full">
          <Textarea id={`note-${item.id}`} rows={3} value={note} onChange={(e) => change(e.target.value)} onBlur={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; latest.current(note); } }} data-testid="item-note" />
        </FormField>
      )}
      {children}
    </div>
  );
}
