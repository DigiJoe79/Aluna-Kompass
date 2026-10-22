'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Overline } from '@/components/overline';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { SearchField } from '@/components/search-field';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Disclosure } from '@/components/ui/disclosure';
import { setRole, type AssistantState, type ColumnRole } from '@/lib/finance/csv-assistant-state';
import { duplicateRoleIndices, entryGroups, matchesColumn, requiredChecks, sampleValues, type RequiredCheck } from '@/lib/finance/csv-columns';
import { ColumnRoleRow } from './column-role-row';

type ColumnsT = ReturnType<typeof useTranslations<'finance.csvAssistant.columns'>>;

/** Höchstens so viele Werte nennt der Hinweis am Wertefeld (Spec 2026-10-22, Verhalten 6). */
const MAX_HINT_VALUES = 8;

const rolesOf = (header: string[], state: AssistantState): ColumnRole[] => header.map((_, i) => state.roles[i] ?? 'ignore');

/**
 * Die Zeile in der Leiste des Schritts (`FormActionBar note`): was noch offen ist — bei doppelter Rolle deren Satz —
 * oder dass alle Pflichtrollen vergeben sind, mit der Zahl der Spalten mit Rolle.
 */
export function columnsNote(header: string[], state: AssistantState, t: ColumnsT): string {
  const roles = rolesOf(header, state);
  const open = requiredChecks(header, state)
    .filter((check) => !check.done)
    .map((check) => t(`requiredItems.${check.key}`));
  if (duplicateRoleIndices(roles).size > 0) open.push(t('reasons.duplicateRole'));
  if (open.length > 0) return t('barOpen', { what: open.join(' · ') });
  return t('barDone', { count: roles.filter((role) => role !== 'ignore').length });
}

/**
 * Schritt 3 des CSV-Assistenten als Liste (Spec 2026-10-22, Board CSV Spalten 1a–1f): oben „Pflicht“, dann die Spalten,
 * die beim Betreten eine Rolle hatten, darunter alle übrigen eingeklappt und durchsuchbar. Die Gruppen stehen beim
 * Betreten fest — eine unten gewählte Rolle lässt die Zeile an Ort und Stelle wachsen; der Assistent mountet den
 * Schritt bei jedem Betreten neu.
 */
export function ColumnsStep({ header, rows, state, onChange }: { header: string[]; rows: string[][]; state: AssistantState; onChange: (next: AssistantState) => void }) {
  const t = useTranslations('finance.csvAssistant.columns');
  const locale = useLocale();
  const roles = rolesOf(header, state);
  const [groups] = useState(() => entryGroups(roles));
  const [query, setQuery] = useState('');

  const duplicates = duplicateRoleIndices(roles);
  const guessedAt = (i: number) => (state.guessed[i] ?? false) && roles[i] !== 'ignore';
  const guessedCount = header.filter((_, i) => guessedAt(i)).length;
  const columnList = new Intl.ListFormat(locale, { type: 'conjunction' });

  const detail = (check: RequiredCheck): string => {
    if (!check.done) return check.key === 'amount' ? t('missing') : t('missingItem');
    if (check.key === 'indicatorValues') return state.indicatorValues.trim();
    if (check.key === 'pendingValues') return state.pendingValues.trim();
    return columnList.format(check.columns.map((column) => t('requiredColumn', { column })));
  };
  const items: RequirementListItem[] = requiredChecks(header, state).map((check) => ({
    key: check.key,
    title: t(`requiredItems.${check.key}`),
    done: check.done,
    blocked: false,
    detail: detail(check),
    canSelf: false,
    canDoNames: [],
    canDoText: '',
    href: null,
    actionLabel: '',
    doneLabel: t('requiredDone'),
  }));

  const renderRow = (i: number) => (
    <ColumnRoleRow
      key={i}
      column={header[i]!}
      index={i}
      values={sampleValues(rows, i, MAX_HINT_VALUES)}
      role={roles[i]!}
      guessed={guessedAt(i)}
      duplicate={duplicates.has(i)}
      compact={roles[i] === 'ignore'}
      rowsCount={rows.length}
      state={state}
      onRole={(role) => onChange(setRole(state, i, role))}
      onValues={(field, value) => onChange({ ...state, [field]: value })}
    />
  );
  const list = (indices: number[]) => <ul className="divide-y divide-line overflow-clip rounded-md border border-line">{indices.map(renderRow)}</ul>;

  const grownBelow = groups.more.some((i) => roles[i] !== 'ignore');
  const matching = groups.more.filter((i) => matchesColumn(header, rows, i, query));
  const moreWithRole = groups.more.filter((i) => roles[i] !== 'ignore').length;

  return (
    <Section title={t('title')}>
      <div data-testid="csv-columns" className="space-y-6">
        <p className="max-w-prose text-body text-ink-2">{t('text')}</p>

        <div className="space-y-2.5 rounded-md border border-line bg-surface-2 px-4 py-3.5">
          <Overline>{t('required')}</Overline>
          <RequirementList variant="compact" items={items} />
          {guessedCount > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line pt-2.5 text-meta text-ink-2">
              <StatusBadge tone="agent">{t('guessed')}</StatusBadge>
              <span>{t('guessedLine', { count: guessedCount })}</span>
            </p>
          ) : null}
        </div>

        {groups.withRole.length === 0 ? (
          list(groups.more)
        ) : (
          <>
            <div className="space-y-2">
              <Overline>{`${t(grownBelow ? 'withRoleOnEntry' : 'withRole')} · ${groups.withRole.length}`}</Overline>
              {list(groups.withRole)}
            </div>
            {groups.more.length > 0 ? (
              <Disclosure label={t('more')} count={groups.more.length} bounded={false}>
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <SearchField value={query} onChange={setQuery} placeholder={t('search')} placeholderShort={t('searchShort')} />
                    <span className="text-muted-ink">{t('moreSummary', { withRole: moreWithRole, ignored: groups.more.length - moreWithRole })}</span>
                  </div>
                  {matching.length > 0 ? list(matching) : <p className="text-body text-ink-2">{t('noMatch', { query: query.trim() })}</p>}
                </div>
              </Disclosure>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}
