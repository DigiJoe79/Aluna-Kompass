import { getTranslations } from 'next-intl/server';
import { LimitProgress, limitState } from '@/components/finance/limit-progress';
import { formatEuro } from '@/lib/finance/amount';

export interface PersonCardData {
  contactId: string;
  contactName: string;
  allowanceVolunteerCents: number;
  allowanceTrainerCents: number;
  reimbursementCents: number;
  reimbursementClaimCount: number;
  /** Befund AJ: verzichtete Auslagen — gesondert, nie als Erstattung. */
  waivedCents: number;
  allowanceVolunteerCapCents: number;
  allowanceTrainerCapCents: number;
  /** Befund AI: vom Dienst — die Oberfläche rechnet die Überschreitung nicht mehr selbst. */
  allowanceVolunteerOverCents: number;
  allowanceTrainerOverCents: number;
}

/**
 * D4 Karte (Designer-README 4f): je Pauschale Baustein 16 gegen die Grenze
 * (*ruhig · nähert sich · überschritten*), darunter die Erstattungen des
 * Jahres. „Überschritten“ nennt die Folge in einem Satz.
 */
export async function PersonCard({ person, year, warnAtPercent }: { person: PersonCardData; year: number; warnAtPercent: number }) {
  const t = await getTranslations('finance.people.card');
  const tLimit = await getTranslations('finance.limitProgress');
  const bars = [
    { key: 'volunteer', value: person.allowanceVolunteerCents, cap: person.allowanceVolunteerCapCents, over: person.allowanceVolunteerOverCents },
    { key: 'trainer', value: person.allowanceTrainerCents, cap: person.allowanceTrainerCapCents, over: person.allowanceTrainerOverCents },
  ].filter((b) => b.value > 0);

  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4" data-testid="person-card">
      <h3 className="font-heading text-[16px] text-ink">{person.contactName}</h3>
      {bars.map((b) => {
        const state = limitState({ valueCents: b.value, limitCents: b.cap, warnAtPercent, kind: 'limit' });
        // Entscheidung 9: derselbe Satz wie die Warnung beim Buchen (Befund AI) — vom Steuerberater zu bestätigen.
        const remainder =
          b.over > 0
            ? t('exceededSentence', { person: person.contactName, amount: formatEuro(b.over), allowance: t(b.key as 'volunteer' | 'trainer'), year })
            : b.cap > 0
              ? t('rest', { amount: formatEuro(b.cap - b.value) })
              : undefined;
        return (
          <LimitProgress
            key={b.key}
            coveredCents={b.value}
            totalCents={b.cap}
            label={t(b.key as 'volunteer' | 'trainer')}
            state={state}
            stateLabel={state ? tLimit(`states.${state}`) : undefined}
            figure={tLimit('figure', { value: formatEuro(b.value), limit: formatEuro(b.cap) })}
            remainder={remainder}
          />
        );
      })}
      <p className="text-[13px] text-ink-2">{t('reimbursementsWithCount', { year, amount: formatEuro(person.reimbursementCents), count: person.reimbursementClaimCount })}</p>
      {person.waivedCents > 0 ? <p className="text-[13px] text-ink-2" data-testid="person-waived">{t('waived', { year, amount: formatEuro(person.waivedCents) })}</p> : null}
    </section>
  );
}
