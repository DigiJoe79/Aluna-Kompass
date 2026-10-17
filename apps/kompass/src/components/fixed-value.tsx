import Link from 'next/link';
import type { ReactNode } from 'react';
import { Empty } from '@/components/empty-value';
import { FormCell } from '@/components/forms/form-grid';
import type { FieldSize } from '@/components/forms/form-field';
import { cn } from '@/lib/utils';

/**
 * Fester Wert als Text (Entwurf E2, Designer 2026-10-17; docs/MUSTER.md § E): ein Wert, der im Formular steht, dort
 * aber nicht änderbar ist — durch einen Fachschritt festgelegt oder an anderer Stelle gepflegt. Statt eines
 * gesperrten Felds: Beschriftung wie ein Feld, der Wert als Text ohne Rahmen an der Kante der Beschriftung, darunter
 * an der Stelle der Feldhilfe der Grund (Pflicht). Gleiche Mindesthöhe wie ein Feld, damit eine Rasterzeile aus
 * Feld und festem Wert oben, in der Wertzeile und beim Grund fluchtet.
 *
 * Nicht gemeint: ein Feld, das nur gerade gesperrt ist, weil ein anderes fehlt — das bleibt ein Feld mit Hinweis.
 *
 * Vorleser: `role="group"`, Name aus Beschriftung **und** Wert (im Formularmodus läse ein Vorleser Text ohne Feld
 * sonst nicht vor), Beschreibung aus dem Grund. Der Wert ist nicht fokussierbar, nur ein Link darin.
 */
export function FixedValue({
  id,
  label,
  value,
  reason,
  href,
  mono = false,
  size = 'm',
  className,
  testId,
}: {
  id: string;
  label: string;
  /** Leer (`null`, `''`) zeigt „—“; der Grund sagt dann, warum. */
  value: ReactNode;
  /** Pflicht: warum der Wert fest ist („Festgelegt beim Einreichen am …“, „Geführt in …“). */
  reason: ReactNode;
  /** Der Wert selbst ist der Link (z. B. der Bescheid in der Akte). */
  href?: string;
  /** Kennungen (IBAN, Steuernummer, Belegnummer) in Mono wie überall. */
  mono?: boolean;
  size?: FieldSize;
  className?: string;
  testId?: string;
}) {
  const empty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  const text = empty ? <Empty /> : href ? <Link href={href} className="text-link underline underline-offset-2">{value}</Link> : value;
  return (
    <FormCell
      size={size}
      role="group"
      aria-labelledby={[`${id}-label`, `${id}-value`].join(' ')}
      aria-describedby={`${id}-reason`}
      data-testid={testId}
      className={cn('flex flex-col gap-1.5', className)}
    >
      <div id={`${id}-label`} className="text-meta font-semibold text-ink-2">
        {label}
      </div>
      <div
        id={`${id}-value`}
        data-slot="fixed-value"
        data-testid={testId ? `${testId}-value` : undefined}
        className={cn('flex min-h-[var(--field-h)] items-center text-body text-pretty text-ink', mono && 'font-mono')}
      >
        <span className="min-w-0 wrap-break-word">{text}</span>
      </div>
      <p id={`${id}-reason`} className="text-hint text-muted-ink">
        {reason}
      </p>
    </FormCell>
  );
}
