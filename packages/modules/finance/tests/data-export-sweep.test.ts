import { newId, schema } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DATA_EXPORT_KEEP_DAYS, dataExportExpiresAt, sweepDataExports } from '../src/reporting/export/sweep';
import { financeDataExports } from '../src/schema';
import { setupFinance } from './helpers';

const DAY = 86_400_000;

async function exportRow(f: ReturnType<typeof setupFinance>, daysAgo: number, withFile = true) {
  const id = newId();
  const fileName = `data-export-${id.toLowerCase()}.zip`;
  const createdAt = new Date(f.deps.clock.now().getTime() - daysAgo * DAY).toISOString();
  f.deps.db.insert(financeDataExports).values({ id, fiscalYearIds: '[]', designations: '2024, 2025', provisional: '', fileName, sizeBytes: 3, checksum: 'x', createdAt, createdByUserId: f.userId, channel: 'ui' }).run();
  if (withFile) await f.deps.files('finance').write(fileName, new Uint8Array([1, 2, 3]));
  return { id, fileName };
}

const expireAudits = (f: ReturnType<typeof setupFinance>) => f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.dataExport.expire');

describe('Datenexporte aufräumen', () => {
  it('computes the end of the keeping time', () => {
    expect(DATA_EXPORT_KEEP_DAYS).toBe(30);
    expect(dataExportExpiresAt('2026-10-01T10:00:00.000Z')).toBe('2026-10-31T10:00:00.000Z');
  });

  it('deletes the file after 30 days, keeps the row and records it once', async () => {
    const f = setupFinance();
    const old = await exportRow(f, 31);
    const fresh = await exportRow(f, 29);
    expect(await sweepDataExports(f.deps)).toEqual({ removed: 1 });
    expect(await f.deps.files('finance').exists(old.fileName)).toBe(false);
    expect(await f.deps.files('finance').exists(fresh.fileName)).toBe(true);
    const row = f.deps.db.select().from(financeDataExports).where(eq(financeDataExports.id, old.id)).get()!;
    expect(row.fileDeletedAt).not.toBeNull();
    const audits = expireAudits(f);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: 'financeDataExport', entityId: old.id, channel: 'system' });
    expect(JSON.parse(audits[0]!.params ?? '{}')).toEqual({ years: '2024, 2025' });
    expect(await sweepDataExports(f.deps)).toEqual({ removed: 0 });
    expect(expireAudits(f)).toHaveLength(1);
  });

  it('does not stop at a missing file', async () => {
    const f = setupFinance();
    await exportRow(f, 40, false);
    expect(await sweepDataExports(f.deps)).toEqual({ removed: 1 });
  });
});
