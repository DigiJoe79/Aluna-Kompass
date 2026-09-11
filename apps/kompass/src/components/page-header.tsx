import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';

/**
 * `back` steht über dem Titel, nicht neben den Aktionen: Es führt aus der Seite
 * heraus und gehört damit nicht zu dem, was man auf ihr tun kann. Seiten, die
 * man über die Navigation erreicht, lassen es weg — der Wächter dazu steht in
 * `tests/back-navigation.test.ts`.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5">
      {back ? (
        <Link
          href={back.href}
          className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} -ml-2 mb-1`}
        >
          <span aria-hidden>←</span>
          {back.label}
        </Link>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div>
          {title ? <h2 className="font-heading text-[22px]">{title}</h2> : null}
          {description ? <p className="mt-1 text-[14px] text-ink-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
