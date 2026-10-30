import { hasPermission, isModuleEnabled, readSetting, todayIn } from '@kompass/core';
import {
  boardRemunerationResolutionInternal,
  getPermissionMatrix,
  getSetupStatus,
  getVatSettings,
  listAccounts,
  listCategories,
  listDatedValues,
  listFiscalYears,
  listPurposes,
  VAT_DATED_KEYS,
} from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { PanelNav, panelFromQuery } from '@/components/panel-nav';
import { requireSession } from '@/lib/request-context';
import { AccountsPanel } from './accounts-panel';
import { CategoriesPanel } from './categories-panel';
import { ChecklistPanel } from './checklist-panel';
import { DatedValuesPanel, type DatedValueListEntry } from './dated-values-panel';
import { DirectDebitPanel } from './direct-debit-panel';
import { FiscalYearsPanel } from './fiscal-years-panel';
import { PermissionsPanel } from './permissions-panel';
import { PurposesPanel } from './purposes-panel';
import { ReportsPanel } from './reports-panel';
import { TaxPanel } from './tax-panel';
import { VatPanel } from './vat-panel';

const PANELS = ['checklist', 'accounts', 'categories', 'purposes', 'fiscalYears', 'datedValues', 'tax', 'vat', 'directDebit', 'reports', 'permissions'] as const;

export default async function AdminFinancePage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'finance')) return <Page width="standard"><ModuleInactiveCard namespace="finance.common" /></Page>;
  // Die Checkliste (`getSetupStatus`) liest auch, wer nur `finance.read` trägt — die Seite
  // sperrt deshalb nicht strenger als der Dienst, den sie zeigt.
  if (!hasPermission(ctx, 'finance.setup') && !hasPermission(ctx, 'finance.read')) return <Page width="standard"><ForbiddenCard permission="finance.setup" /></Page>;
  const t = await getTranslations('finance.admin');
  const query = await searchParams;
  const panel = panelFromQuery(query.panel, PANELS, 'checklist');
  const tabs = await getTranslations('finance.admin.tabs');
  const canManageDms = hasPermission(ctx, 'dms.view');

  let content: React.ReactNode = null;
  if (panel === 'checklist') {
    const statusRes = await getSetupStatus(deps, ctx);
    content = statusRes.ok ? (
      <ChecklistPanel
        steps={statusRes.value.steps.map((s) => ({ key: s.key, required: s.required, done: s.done, blocked: s.blocked, detail: s.detail, canDo: s.canDo, canSelf: hasPermission(ctx, s.permission) }))}
        complete={statusRes.value.complete}
      />
    ) : null;
  } else if (panel === 'accounts') {
    const accountsRes = await listAccounts(deps, ctx, { includeInactive: true });
    content = accountsRes.ok ? (
      <AccountsPanel
        accounts={accountsRes.value.map((a) => ({ id: a.id, expectedVersion: a.updatedAt, name: a.name, kind: a.kind, iban: a.iban, bic: a.bic, bankName: a.bankName, openingBalanceCents: a.openingBalanceCents, openingDate: a.openingDate, isMain: a.isMain, isActive: a.isActive }))}
        canPickDocument={canManageDms}
      />
    ) : null;
  } else if (panel === 'categories') {
    const categoriesRes = await listCategories(deps, ctx, { includeInactive: true });
    const confirmedAt = readSetting<string | null>(deps, 'finance.setupCategoriesConfirmedAt');
    content = categoriesRes.ok ? (
      <CategoriesPanel categories={categoriesRes.value.map((c) => ({ ...c, expectedVersion: c.updatedAt }))} confirmedAt={confirmedAt} />
    ) : null;
  } else if (panel === 'purposes') {
    const purposesRes = await listPurposes(deps, ctx, { includeInactive: true });
    content = purposesRes.ok ? <PurposesPanel purposes={purposesRes.value.map((p) => ({ ...p, expectedVersion: p.updatedAt }))} /> : null;
  } else if (panel === 'fiscalYears') {
    const yearsRes = await listFiscalYears(deps, ctx);
    content = yearsRes.ok ? <FiscalYearsPanel years={yearsRes.value.map((y) => ({ ...y, expectedVersion: y.updatedAt }))} /> : null;
  } else if (panel === 'datedValues') {
    const valuesRes = await listDatedValues(deps, ctx);
    // E6a: Die Einstellung „Umsatzsteuer“ steht im eigenen Reiter `vat` (Task 11b), nicht in dieser Tafel: Ihre Werte
    // gelten gemeinsam ab einem Tag und haben eigene Einheiten (Ja/Nein, USt-IdNr., Bundesland).
    const vatKeys: readonly string[] = VAT_DATED_KEYS;
    content = valuesRes.ok ? <DatedValuesPanel entries={valuesRes.value.filter((v) => !vatKeys.includes(v.key)) as DatedValueListEntry[]} /> : null;
  } else if (panel === 'tax') {
    content = (
      <TaxPanel
        switches={{
          membershipFeesCertifiable: readSetting<boolean>(deps, 'finance.membershipFeesCertifiable'),
          expenseWaiversEnabled: readSetting<boolean>(deps, 'finance.expenseWaiversEnabled'),
        }}
        limits={{
          statementSufficesBelowCents: readSetting<number>(deps, 'finance.statementSufficesBelowCents'),
          cashDonationAlertCents: readSetting<number>(deps, 'finance.cashDonationAlertCents'),
          roundAmountFromCents: readSetting<number>(deps, 'finance.roundAmountFromCents'),
          proofGraceDays: readSetting<number>(deps, 'finance.proofGraceDays'),
        }}
        confirmedAt={readSetting<string | null>(deps, 'finance.setupTaxConfirmedAt')}
        waiverBasisText={readSetting<string>(deps, 'finance.expenseWaiverBasisText')}
        waiverBasisAgreedOn={readSetting<string | null>(deps, 'finance.expenseWaiverBasisAgreedOn')}
        boardRemuneration={{
          allowed: readSetting<boolean>(deps, 'finance.boardRemunerationAllowed'),
          basisText: readSetting<string>(deps, 'finance.boardRemunerationBasisText'),
          validFrom: readSetting<string | null>(deps, 'finance.boardRemunerationValidFrom'),
          decidedOn: readSetting<string | null>(deps, 'finance.boardRemunerationDecidedOn'),
          managed: boardRemunerationResolutionInternal(deps, ctx),
        }}
      />
    );
  } else if (panel === 'vat') {
    const vatRes = await getVatSettings(deps, ctx, {});
    content = vatRes.ok ? <VatPanel view={vatRes.value} today={todayIn(deps)} canEdit={hasPermission(ctx, 'finance.setup')} /> : null;
  } else if (panel === 'directDebit') {
    const accountsRes = await listAccounts(deps, ctx, {});
    const format = readSetting<{ prefix: string; digits: number }>(deps, 'finance.sepa.mandateReferenceFormat');
    content = accountsRes.ok ? (
      <DirectDebitPanel
        values={{
          enabled: readSetting<boolean>(deps, 'finance.sepa.enabled'),
          creditorId: readSetting<string | null>(deps, 'finance.sepa.creditorId') ?? '',
          creditorName: readSetting<string | null>(deps, 'finance.sepa.creditorName') ?? '',
          accountId: readSetting<string | null>(deps, 'finance.sepa.accountId') ?? '',
          leadBusinessDays: readSetting<number>(deps, 'finance.sepa.leadBusinessDays'),
          maxLeadDays: readSetting<number>(deps, 'finance.sepa.maxLeadDays'),
          preNotificationDays: readSetting<number>(deps, 'finance.sepa.preNotificationDays'),
          batchBooking: readSetting<boolean>(deps, 'finance.sepa.batchBooking'),
          prefix: format.prefix,
          digits: format.digits,
        }}
        // Eingezogen wird nur auf ein Bankkonto mit IBAN (`sepaSetupState`).
        accounts={accountsRes.value.filter((a) => a.kind === 'bank' && a.iban).map((a) => ({ id: a.id, name: a.name, isMain: a.isMain }))}
        organizationName={readSetting<string>(deps, 'organization.name')}
      />
    ) : null;
  } else if (panel === 'reports') {
    content = <ReportsPanel values={{ statuteReference: readSetting<string>(deps, 'finance.reports.statuteReference'), cashReportSignature: readSetting<boolean>(deps, 'finance.reports.cashReportSignature'), treasurerIsStatutoryBoard: readSetting<boolean | null>(deps, 'finance.reports.treasurerIsStatutoryBoard'), assemblyApprovesAccounts: readSetting<boolean>(deps, 'finance.reports.assemblyApprovesAccounts') === true }} />;
  } else if (panel === 'permissions') {
    const matrixRes = await getPermissionMatrix(deps, ctx);
    content = matrixRes.ok ? <PermissionsPanel activities={matrixRes.value.activities} roles={matrixRes.value.roles} /> : null;
  }

  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <div className="space-y-5">
        <PanelNav
          basePath="/admin/finance"
          panels={PANELS}
          active={panel}
          labels={Object.fromEntries(PANELS.map((k) => [k, tabs(k)])) as Record<(typeof PANELS)[number], string>}
          ariaLabel={t('tabsLabel')}
        />
        {content}
      </div>
    </Page>
  );
}
