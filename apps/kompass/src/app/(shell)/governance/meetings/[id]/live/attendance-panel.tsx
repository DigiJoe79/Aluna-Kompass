'use client';

import type { AttendanceView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { RowMenu } from '@/components/row-menu';
import { SearchField } from '@/components/search-field';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';


export interface AttendanceProps {
  rows: AttendanceView[];
  names: Record<string, string>;
  now: () => string;
  readOnly: boolean;
  founding: boolean;
  canPickContacts: boolean;
  /** Mitglieder mit Stimmrecht am Sitzungstag (Kopfsatz). */
  total: number;
  heldOn: string;
  onArrive: (row: AttendanceView, at: string) => void;
  onLeave: (row: AttendanceView, at: string) => void;
  onAdd: (input: { role: 'guest' | 'founder'; guestLabel?: string; contactId?: string }) => void;
}

const openPeriod = (row: AttendanceView) => row.periods.at(-1)?.to === null ? row.periods.at(-1)! : null;

/**
 * Anwesenheit im Mitlauf (Board 1a/1g): Kopfsatz mit Zahlen, Suche (Enter auf dem ersten Treffer: „Kommt“ bzw.
 * „Geht“ mit der Uhrzeit von jetzt), je Person Kommen, Gehen, Kommt zurück und ⋯ „Mit Uhrzeit eintragen …“; Gäste und
 * bei der Gründung Personen kommen dazu. Speichert sofort über die Warteschlange.
 */
export function AttendancePanel({ rows, names, now, readOnly, founding, canPickContacts, total, heldOn, onArrive, onLeave, onAdd }: AttendanceProps) {
  const t = useTranslations('governance.live.attendance');
  const { date } = useDateFormat();
  const [query, setQuery] = useState('');
  const [timed, setTimed] = useState<{ row: AttendanceView; leave: boolean } | null>(null);
  const [at, setAt] = useState('');
  const [guest, setGuest] = useState(false);
  const [guestLabel, setGuestLabel] = useState('');
  const [founder, setFounder] = useState(false);
  const [person, setPerson] = useState<PickedContact | null>(null);
  const nameOf = (row: AttendanceView) => (row.guest ? (row.guestLabel ?? '') : (names[row.contactId ?? ''] ?? ''));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => !q || nameOf(r).toLowerCase().includes(q)).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'de'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, names]);
  const here = rows.filter((r) => openPeriod(r));
  const gone = rows.filter((r) => r.periods.length > 0 && !openPeriod(r));
  const toggle = (row: AttendanceView, stamp = now()) => (openPeriod(row) ? onLeave(row, stamp) : onArrive(row, stamp));

  return (
    <Section title={t('title')} intro={t('head', { voting: here.filter((r) => !r.guest && r.votingRight).length, gone: gone.length, guests: here.filter((r) => r.guest).length, date: date(heldOn), total })}>
      <div className="flex flex-col gap-3" data-testid="attendance-panel">
        <div
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || readOnly || !shown[0]) return;
            e.preventDefault();
            toggle(shown[0]);
          }}
        >
          <SearchField value={query} onChange={setQuery} placeholder={t('search')} placeholderShort={t('searchShort')} delayMs={0} testId="attendance-search" />
        </div>
        <ul className="flex flex-col">
          {shown.map((row) => {
            const open = openPeriod(row);
            const last = row.periods.at(-1);
            const role = t(`roles.${row.role}`);
            const state = open ? t('here', { role, time: open.from }) : last ? t('gone', { role, time: last.to ?? '' }) : t('away', { role });
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 py-2" data-testid="attendance-row">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">{nameOf(row)}</span>
                  <span className="text-meta text-muted-ink">{state}</span>
                </span>
                {readOnly ? null : (
                  <span className="flex items-center gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => toggle(row)} data-testid="attendance-toggle">
                      {open ? t('leave') : last ? t('return') : t('arrive')}
                    </Button>
                    <RowMenu name={nameOf(row)} items={[{ key: 'time', label: t('withTime'), onSelect: () => { setAt(now()); setTimed({ row, leave: !!open }); } }]} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { setGuestLabel(''); setGuest(true); }}>{t('addGuest')}</Button>
            {founding && canPickContacts ? <Button type="button" variant="outline" size="sm" onClick={() => { setPerson(null); setFounder(true); }}>{t('addFounder')}</Button> : null}
          </div>
        )}
        <p className="text-hint text-muted-ink">{t('foot')}</p>
      </div>
      <ConfirmDialog
        open={timed !== null}
        onOpenChange={(o) => (o ? undefined : setTimed(null))}
        title={t('timeDialog.title')}
        description={t('timeDialog.description')}
        confirmLabel={timed?.leave ? t('leave') : t('arrive')}
        action={async () => {
          if (timed) (timed.leave ? onLeave : onArrive)(timed.row, at);
          return { status: 'success' };
        }}
      >
        <FormField id="attendance-time" label={t('timeDialog.time')} required size="s">
          <Input id="attendance-time" type="time" value={at} onChange={(e) => setAt(e.target.value)} />
        </FormField>
      </ConfirmDialog>
      <ConfirmDialog
        open={guest}
        onOpenChange={setGuest}
        title={t('guestDialog.title')}
        description={t('guestDialog.description')}
        confirmLabel={t('guestDialog.confirm')}
        action={async () => {
          if (guestLabel.trim()) onAdd({ role: 'guest', guestLabel: guestLabel.trim() });
          return { status: 'success' };
        }}
      >
        <FormField id="attendance-guest" label={t('guestDialog.label')} required size="full">
          <Input id="attendance-guest" value={guestLabel} onChange={(e) => setGuestLabel(e.target.value)} />
        </FormField>
      </ConfirmDialog>
      <ConfirmDialog
        open={founder}
        onOpenChange={setFounder}
        title={t('founderDialog.title')}
        description={t('founderDialog.description')}
        confirmLabel={t('founderDialog.confirm')}
        action={async () => {
          if (person) onAdd({ role: 'founder', contactId: person.id });
          return { status: 'success' };
        }}
      >
        <ContactPicker id="attendance-founder" name="contactId" label={t('founderDialog.person')} value={person} onChange={setPerson} kind="person" canCreate />
      </ConfirmDialog>
    </Section>
  );
}
