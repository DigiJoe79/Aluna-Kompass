import { invalid, nameOrEmpty, ok, readLocales, readSetting, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { issueGeneratedDocument } from '@kompass/module-dms';
import { z } from 'zod';
import { countMembersAtInternal } from '../census';
import { COUNT_CERTIFICATE_TEMPLATE_KEY, type CountCertificateInput } from './count-certificate';
import { day } from './shared';

const HUMAN_ONLY_SETTING = 'members.mcpHumanOnlyAllowed';

export const memberCountCertificateSchema = z.object({ date: z.iso.date() });

/**
 * Bescheinigung über die Zahl der Mitglieder zum Stichtag (Spec § 3.4; `members.manage`, nur ein Mensch): gezählt wie
 * `countMembersAt`, ohne Namen, deshalb ohne Schutzbereich.
 */
export async function issueMemberCountCertificate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ documentId: string; number: string }>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, memberCountCertificateSchema, input);
  if (!parsed.ok) return parsed;
  const { date } = parsed.value;
  // M12 (§ 72 BGB): bescheinigt wird ein Bestand, keine Vorschau.
  if (date > todayIn(deps)) return invalid([{ path: 'date', message: 'inFuture' }]);
  const counted = countMembersAtInternal(deps, date);
  const leading = readLocales(deps)[0]!;
  const data: CountCertificateInput = {
    organizationName: (readSetting<string>(deps, 'organization.name') ?? '').trim(),
    date,
    total: counted.total,
    byType: counted.byType.map((t) => ({ name: nameOrEmpty(t.name[leading]), count: t.count })),
  };
  const issued = await issueGeneratedDocument(deps, ctx, {
    templateKey: COUNT_CERTIFICATE_TEMPLATE_KEY,
    input: data,
    subject: `Bescheinigung über die Zahl der Mitglieder zum ${day(date)}`,
    documentDate: todayIn(deps),
    afterIssue: (tx, doc) => {
      recordAudit(tx, deps, ctx, { action: 'members.countCertificate.issue', entityType: 'document', entityId: doc.id, after: { countedOn: date, count: counted.total }, params: { countedOn: date, count: counted.total, documentNumber: doc.number } });
      return null;
    },
  });
  if (!issued.ok) return issued;
  return ok({ documentId: issued.value.document.id, number: issued.value.document.number ?? '' });
}
