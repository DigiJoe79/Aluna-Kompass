'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Notice } from '@/components/notice';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TemplateRow } from '@/lib/document-template-rows';
import { setDocumentBaseAction } from './actions';
import { KeyLine } from '@/components/key-line';
import { Section } from '@/components/section';

interface Base {
  id: string;
  label: string;
  kind: string;
  own: boolean;
  ok: boolean;
  error?: string;
}

/** Eine Dokumentart mit ihrem Namen, wie die Seite sie zeigt. */
export interface TypeRow extends TemplateRow {
  label: string;
}
export interface TypeGroup {
  module: string;
  moduleLabel: string;
  rows: TypeRow[];
}

/** Eine vom Modul genutzte Basis, die die Installation nicht selbst führt (Befund 51 b). */
interface Gap {
  base: string;
  label: string;
  module: string;
}

/**
 * Zwei getrennte Dinge, jedes mit eigener Überschrift: welche Basis-Vorlagen es gibt, und welche Dokumentart
 * auf welcher erscheint. Die zweite Tabelle nennt die wirksame Basis und zeigt eine Abweichung von der Vorgabe
 * als solche – vorher stand dort nur „Vorgabe der Vorlage“, und eine alte Übersteuerung blieb unbemerkt
 * (Befund vom 2026-09-30).
 */
export function BasesPanel({ bases, groups, gaps = [], canManage }: { bases: Base[]; groups: TypeGroup[]; gaps?: Gap[]; canManage: boolean }) {
  const t = useTranslations('documents.bases');
  const router = useRouter();
  const [pending, start] = useTransition();
  // Die Basis-Auswahl steht in den Tabellenzeilen: Die Ablehnung steht über der Tabelle.
  const baseFb = useActionFeedback();
  const usable = bases.filter((b) => b.ok);

  const setBase = (key: string, baseId: string | null) =>
    start(async () => {
      const s = await baseFb.run(() => setDocumentBaseAction(key, baseId), { retry: () => setBase(key, baseId) });
      if (s.status === 'success') router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      {gaps.length > 0 ? (
        <Notice level="warn" title={t('gapsTitle')} testId="base-gaps">
          <p>{t('gapsText')}</p>
          <ul className="mt-1 list-disc pl-5">
            {gaps.map((gap) => (
              <li key={`${gap.module}-${gap.base}`}>{t('gap', { label: gap.label, base: gap.base, module: gap.module })}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <section aria-labelledby="bases-heading" className="rounded-lg border border-line bg-surface p-4">
        <Section title={t('title')} headingId="bases-heading" intro={t('intro')}>
        <Table className="text-meta">
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('columns.base')}</TableHead>
              <TableHead col="status">{t('columns.state')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bases.map((b) => (
              <TableRow key={b.id}>
                {/* Kennung als `KeyLine` unter dem Namen statt eigener Spalte (11-1 B9). */}
                <TableCell col="title">
                  <span className="block">{b.label}</span>
                  <KeyLine>{b.id}</KeyLine>
                </TableCell>
                {/* Runde 3, 165: Der Normalfall (mitgeliefert, bereit) trägt keine Marke; nur eine eigene Basis und ein
                    Fehler. Ohne beides fällt die Spalte weg. */}
                <TableCell col="status">
                  {b.own || !b.ok ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {b.own ? <StatusBadge tone="brand">{t('own')}</StatusBadge> : null}
                      {b.ok ? null : <StatusBadge tone="error">{t('broken')}</StatusBadge>}
                      {b.error ? <span className="text-hint text-error" title={b.error}>{b.error}</span> : null}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </Section>
      </section>

      <section aria-labelledby="types-heading" className="rounded-lg border border-line bg-surface p-4">
        <Section title={t('typesTitle')} headingId="types-heading" intro={t('typesIntro')}>
        <RefusalNotice action state={baseFb.state} />
        {/* `ui/table` statt rohem `<table>`: Ihr Rahmen scrollt am Telefon in sich, vorher schob die Tabelle `main`
            auf 701 px (Befund 14 in 0.2.8). Am Telefon angesehen, ohne eigenen Layout-Test (Projektregel: keine
            Layout-Tests für Einzelstellen). */}
        <Table className="text-meta">
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('columns.type')}</TableHead>
              <TableHead col="status">{t('columns.effective')}</TableHead>
              <TableHead col="actions">{t('columns.choice')}</TableHead>
            </TableRow>
          </TableHeader>
          {groups.map((group) => (
            <TableBody key={group.module}>
              <TableGroupRow colSpan={3}>{group.moduleLabel}</TableGroupRow>
              {group.rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell col="title">
                    <span className="block">{row.label}</span>
                    {row.label === row.key ? null : <KeyLine>{row.key}</KeyLine>}
                  </TableCell>
                  {/* Runde 3, 165: Solange die Vorgabe gilt, sagt die Auswahl daneben dasselbe; die Zelle bleibt leer und
                      fällt ohne Abweichung in der ganzen Liste weg. */}
                  <TableCell col="status" data-testid="effective-base">
                    {row.override || !row.available ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>
                          <span className="block">{row.effectiveLabel}</span>
                          <KeyLine>{row.effectiveBase}</KeyLine>
                        </span>
                        {row.override ? <StatusBadge tone="warning">{t('overridden')}</StatusBadge> : null}
                        {row.available ? null : <StatusBadge tone="error">{t('unavailable')}</StatusBadge>}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell col="actions">
                    <span className="flex items-center gap-2">
                      <Select
                        aria-label={t('choiceFor', { type: row.label })}
                        value={row.override ?? ''}
                        disabled={!canManage || pending}
                        className="w-auto"
                        onChange={(e) => setBase(row.key, e.target.value || null)}
                      >
                        <option value="">{t('useDefault', { base: bases.find((b) => b.id === row.defaultBase)?.label ?? row.defaultBase })}</option>
                        {/* Eine Übersteuerung auf eine Basis, die es nicht mehr gibt, bleibt wählbar sichtbar – sonst zeigte das Feld die Vorgabe. */}
                        {row.override && !usable.some((b) => b.id === row.override) ? <option value={row.override}>{row.override}</option> : null}
                        {usable.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                      </Select>
                      {row.override && canManage ? (
                        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setBase(row.key, null)}>
                          {t('reset')}
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
        </Section>
      </section>
    </div>
  );
}
