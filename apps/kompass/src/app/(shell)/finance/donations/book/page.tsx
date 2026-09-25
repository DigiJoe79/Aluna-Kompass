import { hasPermission } from '@kompass/core';
import { getDonationBook, getDonationReconciliation } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { BookTable } from './book-table';
import { Reconciliation } from './reconciliation';

export interface DonationBookQuery {
  year?: string;
  contact?: string;
}

/** So weit zurück bietet die Jahr-Auswahl an; ältere Jahre gehen über die Adresse. */
const YEARS_BACK = 5;
/** Der höchste Rand, den die Tabelle auf einmal liest — die Summen gelten immer dem ganzen Jahr (Annahme 9). */
const PAGE_LIMIT = 500;

/**
 * Spendenbuch (C4, F6b Task 8, README 3j): Jahr-Auswahl, Summen je Art,
 * Tabelle aller Zuwendungen des Jahres und die Abstimmung „Zuwendungen ↔
 * Bestätigungen“ nach Gründen. Lesen mit `finance.read`. Der Filter
 * `?contact=anonymous` kommt aus der Abstimmung (anonyme Zuwendungen).
 */
export default async function DonationBookPage({ searchParams }: { searchParams: Promise<DonationBookQuery> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.donations.book');

  const query = await searchParams;
  const currentYear = deps.clock.now().getUTCFullYear();
  const parsedYear = query.year && /^\d+$/.test(query.year) ? Number(query.year) : null;
  const year = parsedYear !== null && parsedYear >= 2000 && parsedYear <= currentYear ? parsedYear : currentYear;
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => currentYear - i);
  if (!years.includes(year)) years.push(year);
  const filterAnonymous = query.contact === 'anonymous';

  const [bookRes, reconciliationRes] = await Promise.all([
    getDonationBook(deps, ctx, { year, limit: PAGE_LIMIT, offset: 0 }),
    getDonationReconciliation(deps, ctx, { year }),
  ]);
  if (!bookRes.ok || !reconciliationRes.ok) return <ForbiddenCard permission="finance.read" />;
  const book = bookRes.value;
  const reconciliation = reconciliationRes.value;
  const rows = filterAnonymous ? book.rows.filter((row) => row.contactId === null) : book.rows;

  return (
    <div className="max-w-[1100px] space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <BookTable
        years={years}
        year={year}
        rows={rows}
        sums={book.sums}
        membershipFeesCertifiable={book.membershipFeesCertifiable}
        filterAnonymous={filterAnonymous}
        simplifiedReceiptLimitCents={reconciliation.simplifiedReceiptLimitCents}
      />
      <Reconciliation data={reconciliation} />
    </div>
  );
}
