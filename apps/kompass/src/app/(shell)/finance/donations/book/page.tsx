import { yearIn, hasPermission } from '@kompass/core';
import { getDonationBook, getDonationReconciliation } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ListPager } from '@/components/list-pager';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { BookTable } from './book-table';
import { Reconciliation } from './reconciliation';

export interface DonationBookQuery {
  year?: string;
  contact?: string;
  page?: string;
}

/** So weit zurück bietet die Jahr-Auswahl an; ältere Jahre gehen über die Adresse. */
const YEARS_BACK = 5;
/** Zeilen je Seite; die Summen gelten immer dem ganzen Jahr (Annahme 9). Bis 0.2.8 eine stille Grenze bei 500. */
const PAGE_SIZE = 50;

/**
 * Spendenbuch (C4, F6b Task 8, README 3j): Jahr-Auswahl, Summen je Art,
 * Tabelle aller Zuwendungen des Jahres und die Abstimmung „Zuwendungen ↔
 * Bestätigungen“ nach Gründen. Lesen mit `finance.read`. Der Filter
 * `?contact=anonymous` kommt aus der Abstimmung (anonyme Zuwendungen).
 */
export default async function DonationBookPage({ searchParams }: { searchParams: Promise<DonationBookQuery> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.donations.book');

  const query = await searchParams;
  const currentYear = yearIn(deps);
  const parsedYear = query.year && /^\d+$/.test(query.year) ? Number(query.year) : null;
  const year = parsedYear !== null && parsedYear >= 2000 && parsedYear <= currentYear ? parsedYear : currentYear;
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => currentYear - i);
  if (!years.includes(year)) years.push(year);
  const filterAnonymous = query.contact === 'anonymous';

  const offset = (Math.max(1, Number(query.page) || 1) - 1) * PAGE_SIZE;
  // Der Anonym-Filter wirkt im Dienst, vor dem Blättern — bis 0.2.8 nur auf die ersten 500 (Befund 10).
  const [bookRes, reconciliationRes] = await Promise.all([
    getDonationBook(deps, ctx, { year, contact: filterAnonymous ? 'anonymous' : undefined, limit: PAGE_SIZE, offset }),
    getDonationReconciliation(deps, ctx, { year }),
  ]);
  if (!bookRes.ok || !reconciliationRes.ok) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const book = bookRes.value;
  // „{Treffer} von {alle}“: alle Zuwendungen des Jahres, ohne den Anonym-Filter.
  const yearRes = filterAnonymous ? await getDonationBook(deps, ctx, { year, limit: 1 }) : bookRes;
  const yearTotal = yearRes.ok ? yearRes.value.total : book.total;
  const reconciliation = reconciliationRes.value;
  const rows = book.rows;
  const pageHref = (next: number) => {
    const target = Math.floor(next / PAGE_SIZE) + 1;
    const params = new URLSearchParams();
    params.set('year', String(year));
    if (filterAnonymous) params.set('contact', 'anonymous');
    if (target > 1) params.set('page', String(target));
    const qs = params.toString();
    return qs ? `/finance/donations/book?${qs}` : '/finance/donations/book';
  };

  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <div className="space-y-6">
        <BookTable
          years={years}
          year={year}
          count={{ shown: book.total, total: yearTotal }}
          rows={rows}
          sums={book.sums}
          membershipFeesCertifiable={book.membershipFeesCertifiable}
          filterAnonymous={filterAnonymous}
          simplifiedReceiptLimitCents={reconciliation.simplifiedReceiptLimitCents}
          footer={<ListPager total={book.total} offset={offset} pageSize={PAGE_SIZE} hrefFor={pageHref} footer testId="donation-book-pager" />}
        />
        <Reconciliation data={reconciliation} />
      </div>
    </Page>
  );
}
