import { describe, expect, it } from 'vitest';
import { auditExportEntries } from '@/lib/audit-export';

const entry = { id: 'E1', occurredAt: '2026-09-28T19:49:27.868Z', userName: 'Anna Berger', channel: 'ui', action: 'finance.notice.save', entityType: 'financeNotice', entityId: '01M3MQP' };

/** Befund 5 (0.2.2): Der PDF-Auszug zeigte ISO-Zeit in UTC, rohe Kanäle und IDs, wo die Ansicht Namen zeigt. */
describe('auditExportEntries', () => {
  it('formats the time in the association time zone, translates the channel and names the record', () => {
    const rows = auditExportEntries([entry, { ...entry, id: 'E2', channel: 'system', entityId: 'WEG' }, { ...entry, id: 'E3', entityId: null }], {
      timeZone: 'Europe/Berlin',
      channels: { ui: 'Oberfläche', mcp: 'MCP', system: 'System' },
      labels: { E1: { state: 'ok', label: 'GRD-2026-003' }, E2: { state: 'missing' } },
      deleted: (type) => `gelöscht (${type})`,
      sentences: { E1: 'Bescheid „BEH-2026-003“ geändert', E2: null },
      actionLabel: (action) => (action === 'finance.notice.save' ? 'Bescheid gespeichert' : action),
    });
    expect(rows[0]).toEqual({ occurredAt: '28.09.2026 21:49:27', userName: 'Anna Berger', channel: 'Oberfläche', entityType: 'financeNotice', entityId: '01M3MQP', entityLabel: 'GRD-2026-003', sentence: 'Bescheid „BEH-2026-003“ geändert' });
    // Ohne Satz (alter Eintrag, Aktion ohne Satz) steht der Klartext — nie der Schlüssel.
    expect(rows[1]).toMatchObject({ channel: 'System', entityLabel: 'gelöscht (financeNotice)', sentence: 'Bescheid gespeichert' });
    expect(rows[2]).toMatchObject({ sentence: 'Bescheid gespeichert' });
    expect(rows[2]).toMatchObject({ entityId: null, entityLabel: null });
  });

  it('keeps an unknown channel and a record without a label as they are', () => {
    const [row] = auditExportEntries([{ ...entry, channel: 'neu' }], { timeZone: 'UTC', channels: {}, labels: {}, deleted: () => '', sentences: {}, actionLabel: (action) => action });
    expect(row).toMatchObject({ occurredAt: '28.09.2026 19:49:27', channel: 'neu', entityLabel: null, entityId: '01M3MQP' });
  });
});
