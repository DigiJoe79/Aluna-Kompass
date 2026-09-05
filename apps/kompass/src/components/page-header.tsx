import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title?: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        {title ? <h2 className="font-heading text-[22px]">{title}</h2> : null}
        {description ? <p className="mt-1 text-[14px] text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
