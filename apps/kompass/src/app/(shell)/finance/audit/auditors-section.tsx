'use client';

import type { AuditorView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFileDownload } from '@/lib/use-file-download';
import { removeAuditorAction, startPackageRunAction } from './actions';
import { AuditorDialog, type AuditorDialogValue } from './auditor-dialog';
import { joinNames } from './audit-header';
import { accessGap } from './auditor-hints';
import { EndAccessDialog } from './end-access-dialog';

/** Hat der Prüfer „in Kompass“ noch die Rolle Kassenprüfer? */
const accessOpen = (a: AuditorView) => a.mode === 'kompass' && a.access.hasRole;

/**
 * Abschnitt „Prüfer <Jahr>“ der Schatzmeisterin (Board 12a, 4e, 12h): eine Zeile je Person — Name, darunter Art, Wahl
 * und Verpflichtung als ein Satz; Hinweise zur Unabhängigkeit als `meta`-Zeile mit Link, ohne Farbe; nur ein fehlender
 * Zugang ist eine Warnung. Rechts „zuletzt da …“ bzw. für Papier-Prüfer die Mappe. Liegt der Prüfbericht, steht der
 * Satz zum Zugang oben und „Zugang beenden …“ in der Zeile.
 */
export function AuditorsSection({
  year,
  auditors,
  documents,
  canManage,
  canManageUsers,
  canCreateContact,
  filedAt,
  assemblyOn = null,
  packageFiles,
  packageRunning,
}: {
  year: { id: string; designation: string; closed: boolean };
  auditors: AuditorView[];
  /** Erklärung und Protokoll für den Dialog, aufgelöst mit dem Recht des Aufrufers. */
  documents: Record<string, PickedDocument>;
  canManage: boolean;
  canManageUsers: boolean;
  canCreateContact: boolean;
  /** Seit wann der Prüfbericht liegt (Designer 12h) — sonst `null`. */
  filedAt: string | null;
  /** Datum der MV aus Schritt 11 des Jahresabschlusses (Board 12h, ab Paket C). */
  assemblyOn?: string | null;
  packageFiles: readonly string[];
  packageRunning: boolean;
}) {
  const t = useTranslations('finance.audit');
  const tCommon = useTranslations('common');
  const tMuted = useTranslations('common.muted');
  const fmt = useDateFormat();
  const router = useRouter();
  const [editing, setEditing] = useState<AuditorDialogValue | 'new' | null>(null);
  const [ending, setEnding] = useState<AuditorView | null>(null);
  const [removing, setRemoving] = useState<AuditorView | null>(null);
  // Je Zeile ein eigenes ⋯ (MUSTER § C „Dialoge gesteuert“): Nach dem Schließen geht der Fokus an den Auslöser zurück —
  // das ⋯ der Zeile oder den Knopf, von dem aus der Dialog aufging (Plan D1d Task 6).
  const menuRefs = useRef(new Map<string, { current: HTMLButtonElement | null }>());
  const menuRefOf = (id: string) => {
    let ref = menuRefs.current.get(id);
    if (!ref) {
      ref = { current: null };
      menuRefs.current.set(id, ref);
    }
    return ref;
  };
  const returnTo = useRef<HTMLElement | null>(null);
  const fromMenu = (id: string) => {
    returnTo.current = menuRefOf(id).current;
  };
  const start = useActionFeedback();
  const folder = useFileDownload({ forbidden: t('downloadRefused.forbidden'), notFound: t('downloadRefused.notFound'), failed: t('downloadRefused.failed') });

  const dialogValue = (a: AuditorView): AuditorDialogValue => ({
    id: a.id,
    version: a.version,
    contact: { id: a.contactId, name: a.contactName },
    mode: a.mode,
    confidential: a.confidential,
    confidentialityDocument: a.confidentialityDocumentId ? (documents[a.confidentialityDocumentId] ?? null) : null,
    electedOn: a.electedOn,
    minutesDocument: a.minutesDocumentId ? (documents[a.minutesDocumentId] ?? null) : null,
  });

  const stillSeeing = filedAt ? auditors.filter(accessOpen) : [];

  const startPackage = async () => {
    const result = await start.run(() => startPackageRunAction(year.id), { retry: () => void startPackage() });
    if (result.status === 'success') router.refresh();
  };

  const sentence = (a: AuditorView) =>
    [
      a.mode === 'kompass' ? t('auditors.mode.kompass') : t('auditors.mode.paper'),
      a.electedOn ? t('auditors.electedOn', { date: fmt.date(a.electedOn) }) : null,
      a.confidentialityDocumentId ? t('auditors.confidentialDocument') : a.confidential ? t('auditors.confidential') : t('auditors.notConfidential'),
      filedAt && accessOpen(a) ? t('auditors.accessOpen') : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const hints = (a: AuditorView) => {
    const board = (() => {
      const role = a.independence.boardRole;
      if (!role) return null;
      return role.until ? t('auditors.boardRoleUntil', { year: year.designation, since: fmt.date(role.since), until: fmt.date(role.until) }) : t('auditors.boardRole', { year: year.designation, since: fmt.date(role.since) });
    })();
    const involved = a.independence.involvedEntryIds;
    const others = auditors.filter((o) => o.id !== a.id).map((o) => o.contactName);
    return (
      <>
        {board ? <p className="text-meta text-muted-ink">{board}</p> : null}
        {involved.length > 0 ? (
          <p className="text-meta text-muted-ink">
            {others.length > 0 ? t('auditors.involved', { count: involved.length, other: joinNames(others, t('head.and')) }) : t('auditors.involvedNoOther', { count: involved.length })}{' '}
            <Link href={`/finance/entries?ids=${involved.join(',')}`} className="text-link underline-offset-2 hover:underline">
              {t('auditors.involvedLink')}
            </Link>
          </p>
        ) : null}
      </>
    );
  };

  const gapNotice = (a: AuditorView) => {
    if (a.mode !== 'kompass') return null;
    const gap = accessGap(a.access);
    if (!gap) return null;
    const label = gap === 'noUser' ? t('auditors.access.createUser') : gap === 'inactive' ? t('auditors.access.openUser') : t('auditors.access.giveRole');
    // Eine Seite je Nutzer gibt es nicht: Die Nutzerverwaltung öffnet gefiltert auf den Namen.
    const href = gap === 'noUser' ? '/admin/users' : `/admin/users?text=${encodeURIComponent(a.contactName)}`;
    return (
      <div className="mt-2">
        <Notice
          level="warn"
          action={
            canManageUsers ? (
              <Link href={href} className="text-meta text-link underline underline-offset-2">
                {label}
              </Link>
            ) : undefined
          }
        >
          {t(`auditors.access.${gap}`)}
          {canManageUsers ? null : ` ${t('auditors.access.askAdmin')}`}
        </Notice>
      </div>
    );
  };

  const right = (a: AuditorView) => {
    if (a.mode === 'paper') {
      if (packageFiles.includes('folder'))
        return (
          <Button type="button" variant="outline" size="sm" disabled={folder.busy} onClick={() => void folder.download(`/finance/audit/year/${encodeURIComponent(year.id)}/package/folder`, `Pruefmappe-${year.designation}.pdf`)}>
            {t('auditors.folder')}
          </Button>
        );
      if (!year.closed) return null;
      if (packageRunning) return <span className="text-meta text-muted-ink">{t('auditors.packageRunning')}</span>;
      // Ein Papier-Prüfer braucht nur die Mappe: derselbe Lauf, benannt nach dem, was er bekommt (Designer Runde 4).
      return (
        <Button type="button" variant="outline" size="sm" onClick={() => void startPackage()}>
          {t('auditors.folderCreate')}
        </Button>
      );
    }
    if (a.access.endedAt && !a.access.hasRole) return <span className="text-meta text-muted-ink">{t('auditors.accessEnded', { date: fmt.date(a.access.endedAt) })}</span>;
    if (!a.access.userId) return null;
    return <span className="text-meta text-muted-ink">{a.access.lastLoginAt ? t('auditors.lastLogin', { date: fmt.date(a.access.lastLoginAt) }) : t('auditors.neverLoggedIn')}</span>;
  };

  return (
    <FormCard as="section">
      <FormCardBody>
        <Section
          title={t('auditors.title', { year: year.designation })}
          actions={
            canManage ? (
              <Button type="button" variant="outline" size="sm" onClick={(e) => { returnTo.current = e.currentTarget; setEditing('new'); }} data-testid="auditor-add">
                {t('auditors.add')}
              </Button>
            ) : null
          }
        >
          {stillSeeing.length > 0 ? (
            <p className="text-body text-ink-2" data-testid="auditors-filed">
              {/* Ein Satz nach dem späteren Ereignis (260): nach der MV nur sie, ohne angehängten Link. */}
              {assemblyOn
                ? t('auditors.filedNoticeAssembly', { assembly: fmt.date(assemblyOn) })
                : t('auditors.filedNotice', { date: fmt.date(filedAt), names: joinNames(stillSeeing.map((a) => a.contactName), t('head.and')), count: stillSeeing.length })}
            </p>
          ) : null}
          <RefusalNotice state={start.state} />
          <RefusalNotice state={folder.refusal} />
          {auditors.length === 0 ? (
            <p className="text-meta text-muted-ink">{t('auditors.empty')}</p>
          ) : (
            <Table>
              <TableHeader className="sr-only">
                <TableRow>
                  <TableHead col="title">{t('auditors.title', { year: year.designation })}</TableHead>
                  <TableHead col="meta">{t('auditors.accessHead')}</TableHead>
                  <TableHead col="actions">
                    <span className="sr-only">{tCommon('rowActionsColumn')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditors.map((a) => (
                  // Zugang beendet: die ganze Zeile gedämpft; den Zustand sagt der Satz „Zugang beendet am …“ rechts, keine Marke
                  // daneben, die dasselbe sagt (Designer Runde 7, 293). Darum `mutedMark="inline"` ohne `MutedMark`: Der Satz nennt den
                  // Zustand auch für Vorleser, die Titelzelle setzte die Marke sonst von selbst ans Ende (Befund 23b).
                  <TableRow key={a.id} data-testid="auditor-row" muted={a.mode === 'kompass' && a.access.endedAt && !a.access.hasRole ? tMuted('ended') : undefined}>
                    <TableCell col="title" mutedMark="inline">
                      <span className="font-semibold">{a.contactName}</span>
                      <span className="block text-meta text-muted-ink">{sentence(a)}</span>
                      {hints(a)}
                      {gapNotice(a)}
                    </TableCell>
                    {/* „Zugang beenden …“ steht bei der Angabe rechts, nicht in der Aktionsspalte: Am Telefon ist sie eine
                        eigene Zeile unter der Kartenzeile, die Aktionsspalte hätte den Namen auf 70 px gedrückt (Designer
                        Runde 8, 281; Runde 7, 307). Am Rechner rechtsbündig, damit Angabe, Knopf und ⋯ beieinander stehen statt
                        über die Breite verteilt (Joe 2026-10-26). Kein Layout-Test (Einzelstelle). */}
                    <TableCell col="meta" wrap>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-2 md:justify-end">
                        {right(a)}
                        {canManage && filedAt && accessOpen(a) ? (
                          <Button type="button" variant="outline" size="sm" onClick={(e) => { returnTo.current = e.currentTarget; setEnding(a); }}>
                            {t('auditors.menu.endAccess')}
                          </Button>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell col="actions">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canManage ? (
                          <RowMenu
                            name={a.contactName}
                            triggerRef={menuRefOf(a.id)}
                            items={[
                              { key: 'edit', label: t('auditors.menu.edit'), onSelect: () => { fromMenu(a.id); setEditing(dialogValue(a)); } },
                              { key: 'endAccess', label: t('auditors.menu.endAccess'), onSelect: () => { fromMenu(a.id); setEnding(a); }, hidden: !accessOpen(a) || Boolean(filedAt) },
                              { key: 'remove', label: t('auditors.menu.remove'), kind: 'delete', onSelect: () => { fromMenu(a.id); setRemoving(a); }, disabledReason: a.hasWork ? t('auditors.hasWork') : undefined },
                            ]}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </FormCardBody>
      {canManage ? (
        <>
          <AuditorDialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))} year={year} auditor={editing === 'new' ? null : editing} canCreateContact={canCreateContact} finalFocus={returnTo} />
          {ending ? <EndAccessDialog open onOpenChange={(open) => (open ? null : setEnding(null))} auditor={{ id: ending.id, name: ending.contactName }} finalFocus={returnTo} /> : null}
          {removing ? (
            <ConfirmDialog
              open
              onOpenChange={(open) => (open ? null : setRemoving(null))}
              title={t('auditors.remove.title', { name: removing.contactName })}
              description={t('auditors.remove.description', { name: removing.contactName, year: year.designation })}
              confirmLabel={t('auditors.remove.confirm')}
              destructive
              finalFocus={returnTo}
              action={async () => {
                const result = await removeAuditorAction(removing.id);
                if (result.status === 'success') {
                  toast.success(t('auditors.remove.done', { name: removing.contactName }));
                  router.refresh();
                }
                return result;
              }}
            />
          ) : null}
        </>
      ) : null}
    </FormCard>
  );
}
