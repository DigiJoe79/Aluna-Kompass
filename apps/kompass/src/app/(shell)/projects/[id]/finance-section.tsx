import { hasPermission, isModuleEnabled, type CallContext, type Deps } from '@kompass/core';
import { getProjectFinance, listPurposes } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { Progress } from '@/components/ui/progress';
import { formatEuro } from '@/lib/finance/amount';
import { FinanceSectionEditor } from './finance-section-editor';

/**
 * Der Finanzabschnitt am Projekt (F3b Task 6). Lebt in der App-Schicht wie
 * `RelatedDocuments`: Projekte kennen Finanzen nicht. Sichtbar mit
 * `finance.overview` oder `finance.read`, wenn das Modul eingeschaltet ist;
 * editierbar nur mit `finance.setup`. Keine Namen, keine Einzelbeträge —
 * `Progress` ist der einzige Balken des Moduls.
 */
export async function ProjectFinanceSection({ deps, ctx, projectId }: { deps: Deps; ctx: CallContext; projectId: string }) {
  if (!isModuleEnabled(deps, 'finance')) return null;
  const canView = hasPermission(ctx, 'finance.overview') || hasPermission(ctx, 'finance.read');
  if (!canView) return null;

  const res = await getProjectFinance(deps, ctx, { projectId });
  if (!res.ok) return null;
  const { settings, result } = res.value;
  const canEdit = hasPermission(ctx, 'finance.setup');

  const t = await getTranslations('finance.projectSection');
  const purposesRes = canEdit ? await listPurposes(deps, ctx, {}) : null;
  const purposes = purposesRes?.ok ? purposesRes.value.map((p) => ({ id: p.id, name: p.name })) : [];

  const progressValue = settings.targetCents && settings.targetCents > 0 ? Math.min(100, Math.round((result.incomeCents / settings.targetCents) * 100)) : null;

  return (
    <section data-testid="project-finance-section" className="space-y-3 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{t('title')}</h2>
        {canEdit ? (
          <FinanceSectionEditor
            projectId={projectId}
            initial={{ targetCents: settings.targetCents, defaultPurposeId: settings.defaultPurposeId, abroad: settings.abroad, publishDonationStatus: settings.publishDonationStatus }}
            purposes={purposes}
          />
        ) : null}
      </div>

      {progressValue !== null ? (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-ink-2">{t('target')}</span>
            <span className="font-mono text-ink">{formatEuro(settings.targetCents!)}</span>
          </div>
          <Progress value={progressValue} data-testid="project-finance-progress" />
        </div>
      ) : (
        <p className="text-[13px] text-muted-ink">{t('noTarget')}</p>
      )}

      <dl className="grid grid-cols-3 gap-3 text-[13px]">
        <div>
          <dt className="text-ink-2">{t('income')}</dt>
          <dd className="font-mono text-ink">{formatEuro(result.incomeCents)}</dd>
        </div>
        <div>
          <dt className="text-ink-2">{t('expense')}</dt>
          <dd className="font-mono text-ink">{formatEuro(result.expenseCents)}</dd>
        </div>
        <div>
          <dt className="text-ink-2">{t('result')}</dt>
          <dd className="font-mono text-ink">{formatEuro(result.resultCents)}</dd>
        </div>
      </dl>
    </section>
  );
}
