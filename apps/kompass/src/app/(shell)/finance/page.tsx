import { redirect } from 'next/navigation';
import { financeLandingPath } from '@/lib/finance/landing';
import { requireSession } from '@/lib/request-context';

/** Einstieg in die Finanzen: Prüfer auf die Kassenprüfung (Board 1b), alle anderen ins Journal. */
export default async function FinancePage() {
  const { ctx } = await requireSession();
  redirect(financeLandingPath(ctx.permissions));
}
