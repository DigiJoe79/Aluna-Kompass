'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { setFinanceSwitchAction } from './actions';

export interface TaxSwitches {
  isEntrepreneurOrHasVatId: boolean;
  membershipFeesCertifiable: boolean;
  expenseWaiversEnabled: boolean;
  mcpHumanOnlyAllowed: boolean;
}

function SwitchRow({ id, label, checked, onToggle, disabled }: { id: string; label: string; checked: boolean; onToggle: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-[14px] text-ink">
      <span>{label}</span>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="size-5 rounded border-line" />
    </label>
  );
}

/** H7 — Steuerliches und Schalter; „Darf ein Agent festschreiben?“ deutlich abgesetzt. */
export function TaxPanel({ switches, confirmedAt }: { switches: TaxSwitches; confirmedAt: string | null }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const toggle = async (key: keyof TaxSwitches, value: boolean) => {
    setPending(true);
    const result = await setFinanceSwitchAction(`finance.${key}`, value);
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <section className="max-w-[560px] space-y-4" data-testid="tax-panel">
      <div>
        <h2 className="font-heading text-[18px] text-ink">{t('title')}</h2>
        <p className="text-[13px] text-muted-ink">{confirmedAt ? t('confirmedAt', { date: confirmedAt.slice(0, 10) }) : t('notConfirmed')}</p>
      </div>
      <div className="divide-y divide-line-2 rounded-md border border-line bg-surface px-3.5">
        <SwitchRow id="tax-entrepreneur" label={t('isEntrepreneurOrHasVatId')} checked={switches.isEntrepreneurOrHasVatId} disabled={pending} onToggle={(v) => void toggle('isEntrepreneurOrHasVatId', v)} />
        <SwitchRow id="tax-membership-fees" label={t('membershipFeesCertifiable')} checked={switches.membershipFeesCertifiable} disabled={pending} onToggle={(v) => void toggle('membershipFeesCertifiable', v)} />
        <SwitchRow id="tax-expense-waivers" label={t('expenseWaiversEnabled')} checked={switches.expenseWaiversEnabled} disabled={pending} onToggle={(v) => void toggle('expenseWaiversEnabled', v)} />
      </div>
      <div className="space-y-1.5 rounded-md border-t-2 border-line-strong bg-surface-2 p-3.5" data-testid="mcp-human-only-row">
        <SwitchRow id="tax-mcp-human-only" label={t('mcpHumanOnlyAllowed')} checked={switches.mcpHumanOnlyAllowed} disabled={pending} onToggle={(v) => void toggle('mcpHumanOnlyAllowed', v)} />
        <p className="text-[12px] text-muted-ink">{t('mcpHumanOnlyAllowedHint')}</p>
      </div>
    </section>
  );
}
