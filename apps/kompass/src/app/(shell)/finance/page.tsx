import { redirect } from 'next/navigation';

/** Der Bereich hat noch einen Eintrag: Weiterleitung ins Journal. */
export default function FinancePage() {
  redirect('/finance/entries');
}
