import { hasPermission, readSetting, type LocalizedText } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { listAccounts, listCategories, listImportRules, listPurposes, TAX_CODES } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { ruleConditionParts } from '@/lib/finance/work-dialogs';
import { requireSession } from '@/lib/request-context';
import { RulesTable, type RuleRow } from './rules-table';

/**
 * „Regeln“ (F5 Task 8, HANDOFF § 12.8): Bedingung → Ergebnis, wie viele
 * frühere Umsätze sie träfe, ob sie aktiv ist, und ob ihre Kategorie
 * stillgelegt wurde. Bearbeiten öffnet den Regel-Dialog der Arbeitsliste,
 * Löschen fragt nach. Lesen mit `finance.read`, Ändern mit `finance.entriesWrite`.
 */
export default async function FinanceRulesPage() {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.work.pages.rules');
  const [rulesRes, accountsRes, categoriesRes, purposesRes, projectsRes] = await Promise.all([
    listImportRules(deps, ctx, { includeInactive: true }),
    listAccounts(deps, ctx, { includeInactive: true }),
    listCategories(deps, ctx, { includeInactive: true }),
    listPurposes(deps, ctx, {}),
    listProjects(deps, ctx),
  ]);
  if (!rulesRes.ok) return <ForbiddenCard permission="finance.read" />;
  const accounts = accountsRes.ok ? accountsRes.value : [];
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const categories = categoriesRes.ok ? categoriesRes.value : [];
  const leading = deps.locales()[0] ?? 'de';

  const contactNames = new Map<string, string>();
  for (const id of new Set(rulesRes.value.rules.map((r) => r.contactId).filter((id): id is string => !!id))) {
    const res = await getContact(deps, ctx, id);
    if (res.ok) contactNames.set(id, displayName(res.value));
  }

  const rows: RuleRow[] = rulesRes.value.rules.map((rule) => ({
    rule: {
      id: rule.id, name: rule.name, isActive: rule.isActive, accountId: rule.accountId, direction: rule.direction as 'in' | 'out' | null, counterpartyIban: rule.counterpartyIban, textContains: rule.textContains,
      amountMinCents: rule.amountMinCents, amountMaxCents: rule.amountMaxCents, categoryId: rule.categoryId, projectId: rule.projectId, purposeId: rule.purposeId, contactId: rule.contactId, taxCode: rule.taxCode, entryText: rule.entryText,
    },
    contactName: rule.contactId ? (contactNames.get(rule.contactId) ?? null) : null,
    conditionTexts: ruleConditionParts({ ...rule, direction: rule.direction as 'in' | 'out' | null }, accountNames).map((part) => t(`parts.${part.key}`, part.values)),
    categoryName: rule.categoryName,
    categoryInactive: rule.categoryInactive,
    hitCount: rule.hitCount,
  }));

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} />
      {rows.length === 0 ? (
        <EmptyState title={t('empty')} text={t('emptyText')} />
      ) : (
        <RulesTable
          rows={rows}
          canWrite={hasPermission(ctx, 'finance.entriesWrite')}
          options={{
            accounts: accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name })),
            categories: categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name })),
            projects: (projectsRes.ok ? projectsRes.value : []).map((p) => ({ id: p.id, name: (p.name as LocalizedText)[leading] || p.slug })),
            purposes: (purposesRes.ok ? purposesRes.value : []).map((p) => ({ id: p.id, name: p.name })),
            taxCodeOptions: [...TAX_CODES],
            showTax: readSetting<boolean>(deps, 'finance.isEntrepreneurOrHasVatId'),
          }}
        />
      )}
    </div>
  );
}
