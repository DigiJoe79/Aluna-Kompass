import { Button } from '@/components/ui/button';

/**
 * Löschen oder Archivieren als letzter Abschnitt einer Detailseite (MUSTER.md § C),
 * nie neben „Speichern“. Der Knopf öffnet den Bestätigungsdialog der Aufrufstelle
 * (`DeleteRecordDialog`/`ConfirmDialog`); hier steht nur Ort und Gestalt.
 */
export function DangerSection({
  title,
  text,
  actionLabel,
  onAction,
  testId,
}: {
  title: string;
  text: string;
  actionLabel: string;
  onAction: () => void;
  testId?: string;
}) {
  return (
    <section className="mt-6 flex flex-col gap-3 rounded-md border border-line bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-[12px] text-ink-2">{text}</p>
      </div>
      <Button type="button" variant="outline" className="w-full whitespace-nowrap sm:w-auto" onClick={onAction} data-testid={testId}>
        {actionLabel}
      </Button>
    </section>
  );
}
