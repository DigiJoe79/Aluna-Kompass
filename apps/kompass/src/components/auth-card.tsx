import type { ReactNode } from 'react';

export function AuthCard({ brand, organization, title, width = 400, children, footer }: { brand: string; organization?: string; title: string; width?: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-bg p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-[34px] items-center justify-center rounded-md border border-brand bg-brand-soft font-heading text-[15px] font-bold text-brand-ink">AK</div>
        <div className="leading-tight">
          {organization ? <div className="text-[15px] font-semibold">{organization}</div> : null}
          <div className={organization ? 'text-[12px] text-muted-ink' : 'font-heading text-[18px]'}>{brand}</div>
        </div>
      </div>
      <section style={{ width }} className="flex max-w-full flex-col gap-5 rounded-lg border border-line bg-surface p-7 shadow-sm">
        <h1 className="font-heading text-[22px]">{title}</h1>
        {children}
      </section>
      {footer ? <p className="max-w-[520px] text-center text-[13px] text-muted-ink">{footer}</p> : null}
    </main>
  );
}
