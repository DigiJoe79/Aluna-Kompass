import type { ReactNode, Ref } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import type { ActionState } from '@/lib/actions';

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

/** Die Fußleiste der Freigabe: Entscheidung ablehnen oder freigeben, mit dem Satz, was danach geschieht. */
export interface ApprovalFooter {
  /** Hinweise mit Eingabe (Pflichtbegründungen) — stehen unmittelbar über der Leiste. */
  above?: ReactNode;
  /** Die Sätze links in der Leiste: was nach der Freigabe geschieht, „nur Menschen“. */
  note: ReactNode;
  /** Die Ablehnung der Freigabe; steht mit Auswegen über der Leiste. */
  state?: ActionState;
  /** Der Knopf „Ablehnen“ (sekundär). */
  reject: ReactNode;
  approve: { label: string; onClick: () => void; pending?: boolean; testId?: string };
}

/**
 * Die gemeinsame Detailansicht der Freigaben (Designer-README 3h, HANDOFF
 * § 13.3): Kopf mit Art, Nummer, Betrag groß und Person · was ausgezahlt oder
 * geändert werden soll · die Voraussetzungen · die klebende Fußleiste. Auslagen
 * nutzen sie heute; Zahlung an Partner, Zuordnung ändern und Zweck ändern
 * setzen später ihren eigenen Inhalt ein. Kein Finanzwort im Rahmen — die
 * Beschriftung kommt vom Aufrufer.
 */
export function ApprovalDetailFrame({ head, headRef, children, requirements, footer }: { head: ApprovalDetailHead; headRef?: Ref<HTMLDivElement>; children: ReactNode; requirements?: ReactNode; footer: ApprovalFooter }) {
  return (
    <div className="flex min-h-full flex-col gap-4">
      <div ref={headRef} tabIndex={-1} data-testid="approval-head" aria-labelledby="approval-number" className="space-y-1 rounded-lg border border-line bg-surface p-4 outline-none focus-visible:ring-2 focus-visible:ring-focus">
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
      {footer.above ? <div className="space-y-2">{footer.above}</div> : null}
      <FormActionBar mode="run" testId="approval-footer" note={footer.note} state={footer.state} extraActions={footer.reject} saveLabel={footer.approve.label} saveTestId={footer.approve.testId} pending={footer.approve.pending} onSave={footer.approve.onClick} />
    </div>
  );
}
