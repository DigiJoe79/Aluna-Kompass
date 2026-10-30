'use client';

import type { FundsUseOpeningsOverview, FundsUseOpeningView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRef, useState, type RefObject } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RecordActions } from '@/components/record-actions';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { ValueList } from '../reports/[key]/annual-accounts/value-list';
import { OpeningDialog } from './opening-dialog';

/** Der nächste freie Vortrag: erst das Jahr direkt vor Kompass, dann das davor (M1: offset 2 braucht offset 1). */
const nextOffset = (overview: FundsUseOpeningsOverview): 1 | 2 => (overview.openings.some((o) => o.offset === 1) ? 2 : 1);

/**
 * „Anfangsvortrag erfassen …“ im ⋯ des Kopfs (Designer Frage 4): nur im ersten Kompass-Jahr, mit `finance.setup` und
 * solange es keinen Vortrag gibt — danach steht der Einstieg im Abschnitt. Ist das erste Jahr abgeschlossen, bleibt der
 * Eintrag und der Dialog nennt den Grund (MUSTER „Keine Sperre ohne Grund“, Review Focus 3).
 */
export function OpeningHeaderActions({ overview, yearId, canEdit }: { overview: FundsUseOpeningsOverview; yearId: string; canEdit: boolean }) {
  const t = useTranslations('finance.fundUse.openings');
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!canEdit || overview.firstFiscalYear?.id !== yearId || overview.openings.length > 0) return null;
  const designation = overview.firstFiscalYear.designation;
  return (
    <>
      <RecordActions triggerRef={trigger} actions={[{ key: 'opening', label: t('add'), kind: 'reversible', onSelect: () => setOpen(true), testId: 'funds-use-opening-add' }]} />
      {overview.changeable ? (
        open ? <OpeningDialog overview={overview} offset={1} initial={null} open onOpenChange={setOpen} finalFocus={trigger} /> : null
      ) : (
        <LockedDialog open={open} onOpenChange={setOpen} title={t('dialog.title')} designation={designation} finalFocus={trigger} />
      )}
    </>
  );
}

/** Das erste Jahr ist abgeschlossen: der Dialog nennt den Grund statt der Felder (`fundsUseOpeningLocked`). */
function LockedDialog({ open, onOpenChange, title, designation, finalFocus }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; designation: string; finalFocus?: RefObject<HTMLButtonElement | null> }) {
  const t = useTranslations('finance.fundUse.openings');
  const tErrors = useTranslations('finance.errors.fundsUseOpeningLocked');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={finalFocus}
      title={title}
      description={t('dialog.description')}
      confirmLabel={t('dialog.save')}
      refusal={{ message: `${tErrors('reason', { designation })} ${tErrors('remedy', { designation })}` }}
      action={async () => ({ status: 'idle' })}
    />
  );
}

/**
 * Abschnitt „Anfangsvortrag“ (Designer Frage 4): erst mit dem ersten Vortrag, je Vortrag eine Zeile der Wertliste mit
 * Betrag, Einnahmen, Frist und Beleg bzw. dem Grund, warum er nicht wirkt; „Bearbeiten …“ je Zeile und „Weiteren Vortrag
 * erfassen …“ (höchstens zwei). Ist das erste Jahr abgeschlossen, bleiben beide und nennen im Dialog den Grund (MUSTER „Keine Sperre ohne Grund“, Review Focus 3). Kein Entfernen — „0 €“ hebt einen Vortrag auf.
 * `documents` nennt die Nummer des Belegs, soweit die Akte sie dieser Person zeigt.
 */
export function OpeningsSection({ overview, canEdit, documents }: { overview: FundsUseOpeningsOverview; canEdit: boolean; documents: Record<string, string> }) {
  const t = useTranslations('finance.fundUse.openings');
  const fmt = useDateFormat();
  const [editing, setEditing] = useState<{ offset: 1 | 2; initial: FundsUseOpeningView | null } | null>(null);
  // Fokus nach dem Schließen zurück auf den Auslöser: das ⋯ der Zeile bzw. „Weiteren Vortrag erfassen …“.
  const rowTriggers = useRef<Record<number, HTMLButtonElement | null>>({});
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const focusBack = useRef<HTMLButtonElement | null>(null);
  if (overview.openings.length === 0) return null;
  const detail = (o: FundsUseOpeningView) => {
    const parts = [t('revenue', { designation: o.designation, amount: formatEuro(o.revenueCents) })];
    if (o.effectiveCents === 0 && o.zeroReason) parts.push(t(`zero.${o.zeroReason}`, { designation: o.designation, limit: o.limitCents === null ? '' : formatEuro(o.limitCents) }));
    else parts.push(t('dueBy', { date: fmt.date(o.dueBy) }));
    const number = o.documentId ? documents[o.documentId] : undefined;
    if (number) parts.push(t('document', { number }));
    return parts.join(' · ');
  };
  return (
    <Section title={t('title')} intro={t('intro')}>
      <ValueList
        rows={overview.openings.map((o) => ({
          key: `opening-${o.offset}`,
          label: t('row', { designation: o.designation }),
          value: (
            <span className="inline-flex items-center gap-2">
              {formatEuro(o.amountCents)}
              {canEdit ? (
                <RowMenu
                  name={t('row', { designation: o.designation })}
                  triggerRef={(el) => {
                    rowTriggers.current[o.offset] = el;
                  }}
                  items={[
                    {
                      key: 'edit',
                      label: t('edit'),
                      onSelect: () => {
                        focusBack.current = rowTriggers.current[o.offset] ?? null;
                        setEditing({ offset: o.offset, initial: o });
                      },
                    },
                  ]}
                />
              ) : null}
            </span>
          ),
          detail: detail(o),
        }))}
      />
      {canEdit && overview.openings.length < 2 ? (
        <Button
          ref={moreTrigger}
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => {
            focusBack.current = moreTrigger.current;
            setEditing({ offset: nextOffset(overview), initial: null });
          }}
          data-testid="funds-use-opening-more"
        >
          {t('addMore')}
        </Button>
      ) : null}
      {editing && overview.changeable ? <OpeningDialog overview={overview} offset={editing.offset} initial={editing.initial} open onOpenChange={(next) => !next && setEditing(null)} finalFocus={focusBack} /> : null}
      {editing && !overview.changeable ? <LockedDialog open onOpenChange={(next) => !next && setEditing(null)} title={editing.initial ? t('dialog.editTitle') : t('dialog.title')} designation={overview.firstFiscalYear?.designation ?? ''} finalFocus={focusBack} /> : null}
    </Section>
  );
}
