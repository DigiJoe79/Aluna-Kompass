'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Section } from '@/components/section';

export interface FindingLine {
  id: string;
  text: string;
  href: string | null;
}

/**
 * Block „Feststellungen und offene Fragen · aus den Vermerken“ (Board 12d, Nachtrag): alle Feststellungen und die
 * nicht geklärten Fragen als Text mit Link auf den Vermerk. Ändern geht nur am Vermerk; geklärte Fragen stehen nicht
 * im Bericht.
 */
export function FindingsBlock({ findings, openQuestions, filed = false }: { findings: FindingLine[]; openQuestions: FindingLine[]; /** Nach der Ablage fällt der Satz „Ändern geht nur am Vermerk“ weg (272). */ filed?: boolean }) {
  const t = useTranslations('finance.audit.report.findings');
  const line = (f: FindingLine) => (
    <>
      {f.text}
      {f.href ? (
        <>
          {' '}
          <Link href={f.href} className="text-meta text-link underline-offset-2 hover:underline">
            {t('link')}
          </Link>
        </>
      ) : null}
    </>
  );
  return (
    <FormCard as="section" data-testid="report-findings">
      <FormCardBody>
        <Section title={t('title')} intro={filed ? undefined : t('hint')}>
          {findings.length === 0 && openQuestions.length === 0 ? (
            <p className="text-meta text-muted-ink">{t('none')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {findings.length > 0 ? (
                <ol className="list-decimal space-y-1 pl-5 text-body">
                  {findings.map((f) => (
                    <li key={f.id}>{line(f)}</li>
                  ))}
                </ol>
              ) : null}
              {openQuestions.length > 0 ? (
                <div>
                  <p className="text-meta text-muted-ink">{t('open')}</p>
                  <ul className="list-disc space-y-1 pl-5 text-body">
                    {openQuestions.map((f) => (
                      <li key={f.id}>{line(f)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </Section>
      </FormCardBody>
    </FormCard>
  );
}
