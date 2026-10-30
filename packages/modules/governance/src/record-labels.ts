import { hasPermission, isoDayIn, type CallContext, type Deps, type RecordLabelInput } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { governanceCirculars, governanceMeetings, governanceOffices, governanceOrgans, governanceRegisterFilings, governanceRegisterOccasions, governanceResolutions, governanceStatutes, governanceTerms } from './schema';

const missing: RecordLabelInput = { label: '', href: null, state: 'missing' };

/**
 * Beschriftung der Datensätze des Moduls für Akte, Wiedervorlagen und die Spalte „Objekt“ im Protokoll. Organ und Amt
 * mit Namen (Nutzdaten des Vereins), eine Inhaberschaft mit dem Amt — nie mit dem Namen der Person —, ein Stand als
 * „Satzung vom …“. Link nur für Beschlüsse (eigene Seite). Nicht aus `index.ts` exportieren (MCP-Paritätswächter).
 */
export function governanceRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  let name: string | null;
  let label: RecordLabelInput['label'] | null = null;
  switch (entityType) {
    case 'governanceOrgan':
      name = deps.db.select({ name: governanceOrgans.name }).from(governanceOrgans).where(eq(governanceOrgans.id, id)).get()?.name ?? null;
      break;
    case 'governanceOffice':
      name = deps.db.select({ name: governanceOffices.name }).from(governanceOffices).where(eq(governanceOffices.id, id)).get()?.name ?? null;
      break;
    case 'governanceTerm':
      name =
        deps.db
          .select({ name: governanceOffices.name })
          .from(governanceTerms)
          .innerJoin(governanceOffices, eq(governanceTerms.officeId, governanceOffices.id))
          .where(eq(governanceTerms.id, id))
          .get()?.name ?? null;
      break;
    case 'governanceStatute': {
      const row = deps.db.select({ resolutions: governanceStatutes.resolutions }).from(governanceStatutes).where(eq(governanceStatutes.id, id)).get();
      if (!row) return missing;
      const date = row.resolutions.map((r) => r.on).sort().at(-1);
      name = date ?? '';
      label = date ? { key: 'governance.records.statute', params: { date } } : { key: 'governance.records.statuteDraft' };
      break;
    }
    case 'governanceMeeting': {
      // „{Organ}: {Art} am {Datum}“ — der Satz steht in der Sprachdatei.
      const row = deps.db.select({ organ: governanceOrgans.name, kind: governanceMeetings.kind, heldOn: governanceMeetings.heldOn }).from(governanceMeetings).innerJoin(governanceOrgans, eq(governanceOrgans.id, governanceMeetings.organId)).where(eq(governanceMeetings.id, id)).get();
      if (!row) return missing;
      name = row.organ;
      label = { key: 'governance.records.meeting', params: { organ: row.organ, kind: row.kind, date: row.heldOn } };
      break;
    }
    case 'governanceResolution': {
      // „Beschluss B-2026-003“ nach dem Festschreiben, davor „Beschluss vom {Datum}“.
      const row = deps.db.select({ number: governanceResolutions.number, decidedOn: governanceResolutions.decidedOn }).from(governanceResolutions).where(eq(governanceResolutions.id, id)).get();
      if (!row) return missing;
      name = row.number ?? row.decidedOn;
      label = row.number ? { key: 'governance.records.resolution', params: { number: row.number } } : { key: 'governance.records.resolutionOn', params: { date: row.decidedOn } };
      break;
    }
    case 'governanceCircular': {
      const row = deps.db.select({ requestedOn: governanceCirculars.requestedOn }).from(governanceCirculars).where(eq(governanceCirculars.id, id)).get();
      if (!row) return missing;
      name = row.requestedOn;
      label = { key: 'governance.records.circular', params: { date: row.requestedOn } };
      break;
    }
    case 'governanceRegisterFiling': {
      // „Registeranmeldung vom {Datum}“ — Tag des frühesten Anlasses, sonst der Anlage.
      const row = deps.db.select({ createdAt: governanceRegisterFilings.createdAt }).from(governanceRegisterFilings).where(eq(governanceRegisterFilings.id, id)).get();
      if (!row) return missing;
      const first = deps.db.select({ on: governanceRegisterOccasions.occurredOn }).from(governanceRegisterOccasions).where(eq(governanceRegisterOccasions.filingId, id)).orderBy(asc(governanceRegisterOccasions.occurredOn)).get();
      const date = first?.on ?? isoDayIn(deps, Date.parse(row.createdAt));
      name = date;
      label = { key: 'governance.records.registerFiling', params: { date } };
      break;
    }
    default:
      return null;
  }
  if (name === null) return missing;
  if (!hasPermission(ctx, 'governance.read')) return { label: { key: 'governance.records.forbidden' }, href: null, state: 'forbidden' };
  // Beschlüsse haben eine eigene Seite (G7: Verweise aus Finanzen und Mitgliedern verlinken sie), Registeranmeldungen
  // auch (W-12: Ziel der Wiedervorlage einer Zwischenverfügung); die übrigen noch nicht.
  const href = entityType === 'governanceResolution' ? `/governance/resolutions/${id}` : entityType === 'governanceRegisterFiling' ? `/governance/register/${id}` : null;
  return { label: label ?? name, name, href, state: 'ok', sensitive: false };
}
