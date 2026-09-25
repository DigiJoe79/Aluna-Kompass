import type { ReactNode, Ref } from 'react';

export interface ApprovalDetailHead {
  /** Die Art als umrandetes Kennzeichen („Auslage“, „Verzicht“, später „Zahlung an Partner“, „Zweck ändern“) — wertet nicht. */
  kind: string;
  number: string;
  amount: string;
  person: string;
  /** „eingegangen am …“ */
  received: string;
  /** Eine Zeile unter der Person, etwa die maskierte Erstattungs-IBAN. */
  note?: string;
}

/**
 * Die gemeinsame Detailansicht der Freigaben (Designer-README 3h, HANDOFF
 * § 13.3): Kopf mit Art, Nummer, Betrag groß und Person · was ausgezahlt oder
 * geändert werden soll · die Voraussetzungen · die klebende Fußleiste. Auslagen
 * nutzen sie heute; Zahlung an Partner, Zuordnung ändern und Zweck ändern
 * setzen später ihren eigenen Inhalt ein. Kein Finanzwort im Rahmen — die
 * Beschriftung kommt vom Aufrufer.
 */
export function ApprovalDetailFrame({ head, headRef, children, requirements, footer }: { head: ApprovalDetailHead; headRef?: Ref<HTMLDivElement>; children: ReactNode; requirements?: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col gap-4">
      <div ref={headRef} tabIndex={-1} data-testid="approval-head" aria-labelledby="approval-number" className="space-y-1 rounded-lg border border-line bg-surface p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-[12px] font-semibold text-ink-2">{head.kind}</span>
          <h3 id="approval-number" data-testid="approval-number" className="font-mono text-[15px] font-semibold text-ink">
            {head.number}
          </h3>
        </div>
        <p className="font-mono text-[30px] font-semibold tabular-nums text-ink">{head.amount}</p>
        <p className="text-[14px] text-ink">{head.person}</p>
        <p className="text-[12px] text-muted-ink">
          {head.received}
          {head.note ? ` · ${head.note}` : ''}
        </p>
      </div>
      <div className="space-y-4">{children}</div>
      {requirements ? <div className="space-y-3">{requirements}</div> : null}
      <div data-testid="approval-footer" className="sticky bottom-0 z-10 mt-auto space-y-2 rounded-md border border-line bg-surface px-3 py-3 shadow-md">
        {footer}
      </div>
    </div>
  );
}
