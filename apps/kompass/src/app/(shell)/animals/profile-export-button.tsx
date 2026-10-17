'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useFileDownload } from '@/lib/use-file-download';

/**
 * „Als PDF“ für Liste und Maske (Spec 2026-10-05, § 9). Die Ablehnung steht
 * über dem Knopf (MUSTER A), wie im Backup-Export. Beim ersten Export rechnet
 * der Server die Druckbilder, das kann dauern; der Knopf sagt es.
 */
export function ProfileExportButton({ ids, size }: { ids: readonly string[]; size?: 'sm' }) {
  const t = useTranslations('animals.print');
  const { busy, refusal, download } = useFileDownload({ forbidden: t('refused.forbidden'), notFound: t('refused.notFound'), failed: t('refused.failed') });
  return (
    <div className="flex flex-col items-end gap-1">
      <RefusalNotice action state={refusal} />
      <Button variant="outline" size={size} disabled={busy} aria-busy={busy} data-testid="animals-export" onClick={() => void download(`/animals/export?ids=${ids.join(',')}`, 'profile.pdf')}>
        <Download className="size-4" aria-hidden />
        {busy ? t('running') : t('export')}
      </Button>
    </div>
  );
}

/**
 * Seitenkopf des Tiers mit „Als PDF“ als Nebenaktion (`PageHeader more`; Runde 3, 018): ab `sm` der Knopf, am Telefon
 * ein Eintrag im ⋯ neben „Löschen …“. Die Ablehnung steht über den Kopfaktionen (MUSTER A). Client, weil der Auslöser
 * eine Funktion ist; Titel, Rückweg und die übrigen Aktionen (`children`) reicht die Seite durch.
 */
export function AnimalPageHeader({
  id,
  canExport,
  title,
  description,
  back,
  children,
}: {
  id: string;
  canExport: boolean;
  title: string;
  description?: string;
  back: { href: string; label: string };
  children?: ReactNode;
}) {
  const t = useTranslations('animals.print');
  const { busy, refusal, download } = useFileDownload({ forbidden: t('refused.forbidden'), notFound: t('refused.notFound'), failed: t('refused.failed') });
  return (
    <PageHeader
      title={title}
      description={description}
      back={back}
      more={[
        {
          key: 'export',
          label: busy ? t('running') : t('export'),
          icon: <Download className="size-4" aria-hidden />,
          disabled: busy,
          onSelect: () => void download(`/animals/export?ids=${id}`, 'profile.pdf'),
          hidden: !canExport,
          testId: 'animals-export',
        },
      ]}
      actions={
        <>
          <RefusalNotice action state={refusal} />
          {children}
        </>
      }
    />
  );
}
