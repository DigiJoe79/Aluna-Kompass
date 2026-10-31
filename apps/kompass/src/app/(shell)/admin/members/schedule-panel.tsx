'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { Empty } from '@/components/empty-value';
import { AmountField } from '@/components/finance/amount-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ActionState } from '@/lib/actions';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { saveFeeScheduleAction } from './actions';

type Interval = 'yearly' | 'halfYearly' | 'quarterly' | 'monthly';
const INTERVALS: readonly Interval[] = ['yearly', 'halfYearly', 'quarterly', 'monthly'];

export interface ScheduleRule {
  typeId: string;
  amountCents: number;
  interval: Interval;
  minimum: boolean;
  allowedIntervals: Interval[];
  admissionFeeCents: number | null;
}
export interface ScheduleView {
  id: string;
  validFrom: string;
  resolvedOn: string | null;
  resolutionDocument: { id: string; number: string | null } | null;
  /** G7: der Beschluss in Gremien, beschriftet über `resolveRecordLabel` — ohne Leserecht ohne Link. */
  resolutionRef?: { label: string; href: string | null } | null;
  note: string | null;
  rules: ScheduleRule[];
  locked: boolean;
}
export interface ScheduleType {
  id: string;
  label: string;
  feeExempt: boolean;
  active: boolean;
}

/**
 * Beitragsordnung mit Ständen (Handoff Mitglieder D3, 7a): je Stand ein Abschnitt „Gilt seit …“ mit Beschluss und einer
 * Tabelle Art · Betrag · Rhythmus · Mindestbetrag. Oben der geltende Stand, ein künftiger mit Marke „kommt“, frühere
 * eingeklappt. „Neuen Stand anlegen …“ öffnet einen Dialog `lg`, vorbelegt mit dem letzten Stand; ein Stand mit
 * angelegten Beiträgen ist fest — die Ablehnung bietet „Neuen Stand anlegen“; an ihm lässt sich nur der Beschluss
 * nachtragen (Backlog 97).
 */
export function SchedulePanel({ schedules, types, today }: { schedules: ScheduleView[]; types: ScheduleType[]; today: string }) {
  const t = useTranslations('members.admin.schedule');
  const ti = useTranslations('members.interval');
  const tt = useTranslations('members.admin.types');
  const { date } = useDateFormat();
  const [editing, setEditing] = useState<ScheduleView | 'new' | null>(null);
  const sorted = [...schedules].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const current = sorted.find((s) => s.validFrom <= today) ?? null;
  const future = sorted.filter((s) => s.validFrom > today).reverse();
  const earlier = sorted.filter((s) => s.validFrom <= today && s !== current);
  const latest = sorted[0] ?? null;
  const previousOf = (s: ScheduleView) => sorted[sorted.indexOf(s) + 1] ?? null;
  const shownTypes = (s: ScheduleView) => types.filter((ty) => ty.active || s.rules.some((r) => r.typeId === ty.id));

  // Vor der ersten Tabelle: Die Marke „kommt“ gehört zum Abschnitt, nicht zu einer Zeile.
  const comingBadge = <StatusBadge tone="info" dot>{t('coming')}</StatusBadge>;

  const table = (s: ScheduleView) => {
    const previous = previousOf(s);
    return (
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('columns.type')}</TableHead>
              <TableHead col="amount" className="text-right">{t('columns.amount')}</TableHead>
              <TableHead col="meta">{t('columns.interval')}</TableHead>
              <TableHead col="meta" className="text-right">{t('columns.minimum')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shownTypes(s).map((ty) => {
              const rule = s.rules.find((r) => r.typeId === ty.id);
              const before = previous?.rules.find((r) => r.typeId === ty.id);
              const changed = rule && before && before.amountCents !== rule.amountCents;
              return (
                <TableRow key={ty.id}>
                  <TableCell col="title">
                    <span className="flex flex-col">
                      <span>{ty.label}</span>
                      {changed ? <span className="text-hint text-muted-ink">{t('changed', { amount: formatEuro(before.amountCents) })}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell col="amount" className="text-right tabular-nums text-ink">{rule ? formatEuro(rule.amountCents) : ty.feeExempt ? <span className="text-muted-ink">{tt('exempt')}</span> : <Empty />}</TableCell>
                  <TableCell col="meta" className="text-ink-2">{rule ? ti(rule.interval) : <Empty />}</TableCell>
                  <TableCell col="meta" className="text-right tabular-nums text-ink-2">{rule?.minimum ? formatEuro(rule.amountCents) : <Empty />}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  const resolution = (s: ScheduleView) =>
    s.resolvedOn || s.resolutionDocument || s.resolutionRef ? (
      <span className="flex flex-wrap items-baseline gap-x-1">
        {s.resolvedOn ? t('resolved', { date: date(s.resolvedOn) }) : null}
        {s.resolutionDocument ? (
          <>
            {s.resolvedOn ? ' · ' : null}
            <Link href={`/dms/${s.resolutionDocument.id}`} className="text-link underline-offset-2 hover:underline">{s.resolutionDocument.number ?? t('document')}</Link>
          </>
        ) : null}
        {s.resolutionRef ? (
          <>
            {s.resolvedOn || s.resolutionDocument ? ' · ' : null}
            {s.resolutionRef.href ? <Link href={s.resolutionRef.href} className="text-link underline-offset-2 hover:underline">{s.resolutionRef.label}</Link> : s.resolutionRef.label}
          </>
        ) : null}
      </span>
    ) : undefined;

  const editButton = (s: ScheduleView) => (
    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(s)}>{t('edit')}</Button>
  );

  const newButton = (
    <Button type="button" variant="outline" size="sm" onClick={() => setEditing('new')} data-testid="schedule-new">
      {t('newScale')}
    </Button>
  );

  if (schedules.length === 0) {
    return (
      <>
        <EmptyState title={t('empty')} text={t('emptyText')} action={<Button type="button" onClick={() => setEditing('new')} data-testid="schedule-new">{t('newScale')}</Button>} />
        {editing ? <ScheduleDialog schedule={null} prefill={null} types={types} today={today} onClose={() => setEditing(null)} onNew={() => setEditing('new')} /> : null}
      </>
    );
  }

  return (
    <div className="space-y-6" data-testid="schedule-panel">
      {current ? (
        <Section
          title={t('current', { date: date(current.validFrom) })}
          intro={resolution(current)}
          actions={
            current.locked || future.length === 0 ? (
              <span className="flex flex-wrap items-center gap-2">
                {current.locked ? editButton(current) : null}
                {future.length === 0 ? newButton : null}
              </span>
            ) : undefined
          }
        >
          {table(current)}
        </Section>
      ) : null}
      {future.map((s, i) => (
        <Section
          key={s.id}
          title={t('future', { date: date(s.validFrom) })}
          intro={resolution(s)}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              {comingBadge}
              {editButton(s)}
              {i === future.length - 1 ? newButton : null}
            </span>
          }
        >
          {table(s)}
        </Section>
      ))}
      {earlier.length > 0 ? (
        <Disclosure label={t('earlier')} count={earlier.length}>
          <div className="space-y-6">
            {earlier.map((s) => (
              <Section key={s.id} title={t('current', { date: date(s.validFrom) })} intro={resolution(s)} actions={s.locked ? editButton(s) : undefined}>
                {table(s)}
              </Section>
            ))}
          </div>
        </Disclosure>
      ) : null}
      <p className="text-meta text-muted-ink">{t('locked')}</p>
      {editing ? <ScheduleDialog schedule={editing === 'new' ? null : editing} prefill={editing === 'new' ? latest : editing} types={types} today={today} onClose={() => setEditing(null)} onNew={() => setEditing('new')} /> : null}
    </div>
  );
}

interface RuleDraft {
  typeId: string;
  amount: string;
  interval: Interval;
  minimum: boolean;
  allowedIntervals: Interval[];
  /** Zeigt der Dialog nicht, muss aber mitlaufen — sonst fiele sie beim Speichern weg. */
  admissionFeeCents: number | null;
}

function ScheduleDialog({ schedule, prefill, types, today, onClose, onNew }: { schedule: ScheduleView | null; prefill: ScheduleView | null; types: ScheduleType[]; today: string; onClose: () => void; onNew: () => void }) {
  const t = useTranslations('members.admin.schedule');
  const ti = useTranslations('members.interval');
  const router = useRouter();
  const [validFrom, setValidFrom] = useState(schedule?.validFrom ?? `${Number(today.slice(0, 4)) + 1}-01-01`);
  const [resolvedOn, setResolvedOn] = useState(schedule?.resolvedOn ?? '');
  // Ein fester Stand: Tag und Regeln bleiben, wie sie sind; nur der Beschluss lässt sich nachtragen (Backlog 97).
  const fixed = schedule?.locked ?? false;
  const draft = (r: ScheduleRule): RuleDraft => ({ typeId: r.typeId, amount: formatAmount(r.amountCents), interval: r.interval, minimum: r.minimum, allowedIntervals: r.allowedIntervals, admissionFeeCents: r.admissionFeeCents });
  const [rules, setRules] = useState<RuleDraft[]>(
    fixed && schedule
      ? schedule.rules.map(draft)
      : types
          .filter((ty) => ty.active && !ty.feeExempt)
          .map((ty) => {
            const rule = prefill?.rules.find((r) => r.typeId === ty.id);
            return rule ? draft(rule) : { typeId: ty.id, amount: '', interval: 'yearly', minimum: false, allowedIntervals: ['yearly'], admissionFeeCents: null };
          }),
  );
  // Regeln der Arten ohne Zeile im Dialog (inaktiv) gelten für deren Mitglieder weiter, beim Bearbeiten wie beim neuen
  // Stand. Nur eine inzwischen beitragsfreie Art fällt weg: Für sie lehnt der Dienst jede Regel ab.
  const hiddenRules = (prefill?.rules ?? []).filter((r) => {
    const type = types.find((ty) => ty.id === r.typeId);
    return type && !type.active && !type.feeExempt;
  });
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const set = (typeId: string, patch: Partial<RuleDraft>) => setRules(rules.map((r) => (r.typeId === typeId ? { ...r, ...patch } : r)));

  const save = async () => {
    setPending(true);
    const input = {
      ...(schedule ? { id: schedule.id } : {}),
      validFrom,
      resolvedOn: resolvedOn || null,
      resolutionDocumentId: schedule?.resolutionDocument?.id ?? null,
      note: schedule?.note ?? null,
      rules:
        fixed && schedule
          ? schedule.rules
          : [
              ...rules
                .filter((r) => r.amount.trim() !== '')
                .map((r) => ({ typeId: r.typeId, amountCents: parseAmount(r.amount) ?? -1, interval: r.interval, minimum: r.minimum, allowedIntervals: r.allowedIntervals.includes(r.interval) ? r.allowedIntervals : [r.interval], admissionFeeCents: r.admissionFeeCents })),
              ...hiddenRules,
            ],
    };
    const result = await feedback.run(() => saveFeeScheduleAction(input), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };

  // Ein fester Stand (schon Beiträge danach): Ausweg „Neuen Stand anlegen“ (Handoff § 3, „Stand ändern“).
  const state: ActionState =
    feedback.state.status === 'error' && feedback.state.code === 'feeScheduleLocked' ? { ...feedback.state, remedies: [{ label: t('remedyNew'), onSelect: onNew }] } : feedback.state;
  const typeLabel = (id: string) => types.find((ty) => ty.id === id)?.label ?? '';

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg" layout="fixed-footer">
        <DialogHeader>
          <DialogTitle>{schedule ? t('dialogEdit') : t('dialogNew')}</DialogTitle>
          <DialogDescription>{fixed ? t('dialogLocked') : t('dialogText')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormGrid>
            <FormField id="schedule-valid-from" label={t('validFrom')} required size="s">
              <Input id="schedule-valid-from" type="date" value={validFrom} disabled={fixed} onChange={(e) => setValidFrom(e.target.value)} />
            </FormField>
            <FormField id="schedule-resolved-on" label={t('resolvedOn')} size="s">
              <Input id="schedule-resolved-on" type="date" value={resolvedOn} onChange={(e) => setResolvedOn(e.target.value)} />
            </FormField>
          </FormGrid>
          <div className="overflow-hidden rounded-md border border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead col="title">{t('columns.type')}</TableHead>
                  <TableHead col="amount">{t('columns.amount')}</TableHead>
                  <TableHead col="meta">{t('columns.interval')}</TableHead>
                  <TableHead col="meta">{t('columns.minimum')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.typeId} data-testid="schedule-rule">
                    <TableCell col="title">{typeLabel(r.typeId)}</TableCell>
                    <TableCell col="amount">
                      <AmountField id={`rule-amount-${r.typeId}`} name={`amount-${r.typeId}`} value={r.amount} disabled={fixed} onChange={(amount) => set(r.typeId, { amount })} />
                    </TableCell>
                    <TableCell col="meta">
                      <Select id={`rule-interval-${r.typeId}`} aria-label={`${t('columns.interval')} ${typeLabel(r.typeId)}`} value={r.interval} disabled={fixed} onChange={(e) => set(r.typeId, { interval: e.target.value as Interval })}>
                        {INTERVALS.map((i) => (
                          <option key={i} value={i}>{ti(i)}</option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell col="meta">
                      <Checkbox aria-label={`${t('isMinimum')} ${typeLabel(r.typeId)}`} checked={r.minimum} disabled={fixed} onCheckedChange={(on) => set(r.typeId, { minimum: on === true })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!validFrom} onSave={() => void save()} state={state} testId="schedule-footer" />
      </DialogContent>
    </Dialog>
  );
}
