'use client';

import type { Consequence, MeetingContext, MeetingDetail } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConsequenceList } from '@/components/consequence-list';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { openPoints } from '@/lib/governance/open-points';
import { sealMeetingAction } from './actions';
import type { StepSlot } from './meeting-view';

type T = (key: string, values?: Record<string, string | number>) => string;

/** Ein Satz je Folge des Festschreibens (Board 2c); `none` hat keinen. Nummern fasst `consequenceLines` zusammen. */
export function consequenceLabel(tc: T, tk: T, date: (iso: string) => string, c: Consequence, names: Record<string, string>, offices: MeetingContext['offices']): string | null {
  const p = c.params;
  const name = typeof p.contactId === 'string' ? (names[p.contactId] ?? '') : '';
  const office = offices.find((o) => o.id === p.officeId)?.name ?? '';
  const day = (v: unknown) => (typeof v === 'string' && v ? date(v) : '');
  switch (c.kind) {
    case 'startTerm':
      return tc('startTerm', { name, office, date: day(p.since) });
    case 'linkTerm':
      return tc('linkTerm', { name, office });
    case 'endPredecessor':
      return tc('endPredecessor', { name, office, date: day(p.until) });
    case 'endTerm':
      return tc('endTerm', { name, office, date: day(p.until) });
    case 'statuteResolved':
      return tc('statuteResolved', { date: day(p.on) });
    case 'registerOccasion':
      return tc('registerOccasion', { occasion: tc(`occasions.${String(p.kind)}`), date: day(p.occurredOn) });
    case 'followUp':
      return tc(p.hint === 'noAssignee' ? 'followUpUnassigned' : 'followUp', { title: String(p.title ?? ''), date: day(p.dueAt) });
    case 'financeReference':
      return tc(p.effect === 'write' ? 'financeReferenceWrite' : 'financeReference', { kind: tk(String(p.kind)) });
    case 'memberProposal':
      return tc('memberProposal', { proposal: tc(`proposals.${String(p.proposal)}`) });
    case 'none':
      return p.hint === 'noDeadline' ? tc('followUpNoDeadline') : null;
    default:
      return null;
  }
}

/** Alle Folgen als Sätze: die Nummern zusammengefasst zu einem Satz, dann die übrigen in ihrer Reihenfolge. */
export function consequenceLines(tc: T, tk: T, date: (iso: string) => string, consequences: Consequence[], names: Record<string, string>, offices: MeetingContext['offices']): string[] {
  const numbers = consequences.filter((c) => c.kind === 'numberResolution').map((c) => String(c.params.number));
  const lines = numbers.length ? [tc('numberResolution', { count: numbers.length, from: numbers[0]!, to: numbers.at(-1)! })] : [];
  for (const c of consequences) {
    if (c.kind === 'numberResolution') continue;
    const line = consequenceLabel(tc, tk, date, c, names, offices);
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines;
}

/**
 * Schritt 5 „Festschreiben“ (Board 2c): „Was dabei entsteht:“ als `ConsequenceList`, offene Punkte als letzte Zeile
 * (halten nicht auf), Blocker des Dienstes als Hinweis, „Festschreiben …“ mit Rückfrage. Über einen Agenten lehnt der
 * Dienst ab; das steht im Handbuch.
 */
export function useSealStep({ meeting: m, context: c, canManage }: { meeting: MeetingDetail; context: MeetingContext; canManage: boolean }): StepSlot {
  const t = useTranslations('governance.seal');
  const tc = useTranslations('governance.seal.consequences');
  const tk = useTranslations('governance.agendaKinds');
  const tm = useTranslations('governance.minutes');
  const { date } = useDateFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (m.state !== 'recorded' || !c.seal) return m.state === 'recorded' ? {} : { detail: undefined };
  const lines = consequenceLines(tc as T, tk as T, date, c.seal.consequences, c.names, c.offices);
  const points = openPoints(m, c.names);
  const filed = c.minutes.length > 0;
  const items = [...lines.map((label) => ({ label })), ...(points.length ? [{ label: t('open', { list: points.map((p) => (p.kind === 'acceptanceOpen' ? tm('acceptanceOpen', { n: p.itemNumber, name: p.name }) : tm(p.kind, { n: p.itemNumber }))).join(', ') }) }] : [])];
  return {
    detail: filed ? undefined : t('pending'),
    below: filed ? (
      <div className="flex flex-col gap-3" data-testid="seal-step">
        <p className="text-meta text-ink-2">{t('intro')}</p>
        <ConsequenceList items={items} />
        {c.seal.blockers.filter((b) => b !== 'minutesMissing').map((b) => <Notice key={b} level="warn">{t(`blockers.${b}`)}</Notice>)}
        {c.seal.warnings.map((w) => <Notice key={w} level="warn">{t(`warnings.${w}`)}</Notice>)}
        {canManage ? (
          <div>
            <Button type="button" onClick={() => setOpen(true)} data-testid="meeting-seal">{t('button')}</Button>
          </div>
        ) : null}
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={t('dialog.title')}
          description={t('dialog.description')}
          confirmLabel={t('dialog.confirm')}
          action={async () => {
            const result = await sealMeetingAction(m.id);
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />
      </div>
    ) : undefined,
  };
}
