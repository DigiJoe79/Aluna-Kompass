import { describe, expect, it } from 'vitest';
import { auditExportEntries } from '@/lib/audit-export';

const entry = { id: 'E1', occurredAt: '2026-09-28T19:49:27.868Z', userName: 'Anna Berger', channel: 'ui', action: 'finance.notice.save', entityType: 'financeNotice', entityId: '01M3MQP' };

/** Befund 5 (0.2.2): Der PDF-Auszug zeigte ISO-Zeit in UTC, rohe Kanäle und IDs, wo die Ansicht Namen zeigt. */
describe('auditExportEntries', () => {
  it('formats the time in the association time zone, translates the channel and names the record', () => {
    const rows = auditExportEntries([entry, { ...entry, id: 'E2', channel: 'system', entityId: 'WEG' }, { ...entry, id: 'E3', entityId: null }], {
      timeZone: 'Europe/Berlin',
      channels: { ui: 'Oberfläche', mcp: 'MCP', system: 'System' },
      // Das Objekt wie in der Spalte der Ansicht (`auditObject`): Typ in Worten, Name oder nichts — nie die ID.
      entity: (e) => ({ E1: { word: 'Bescheid', name: 'GRD-2026-003', deleted: null }, E2: { word: 'Bescheid', name: null, deleted: 'gelöscht' } })[e.id] ?? { word: 'Bescheid', name: null, deleted: null },
      sentences: { E1: 'Bescheid „BEH-2026-003“ geändert', E2: null },
      actionLabel: (action) => (action === 'finance.notice.save' ? 'Bescheid gespeichert' : action),
    });
    expect(rows[0]).toEqual({ occurredAt: '28.09.2026 21:49:27', userName: 'Anna Berger', channel: 'Oberfläche', entity: 'Bescheid · GRD-2026-003', entityGone: null, sentence: 'Bescheid „BEH-2026-003“ geändert' });
    // Ohne Satz (alter Eintrag, Aktion ohne Satz) steht der Klartext — nie der Schlüssel.
    expect(rows[1]).toMatchObject({ channel: 'System', entity: 'Bescheid', entityGone: 'gelöscht', sentence: 'Bescheid gespeichert' });
    expect(rows[2]).toMatchObject({ entity: 'Bescheid', sentence: 'Bescheid gespeichert' });
  });

  it('keeps an unknown channel as it is', () => {
    const [row] = auditExportEntries([{ ...entry, channel: 'neu' }], { timeZone: 'UTC', channels: {}, entity: () => ({ word: 'Bescheid', name: null, deleted: null }), sentences: {}, actionLabel: (action) => action });
    expect(row).toMatchObject({ occurredAt: '28.09.2026 19:49:27', channel: 'neu', entity: 'Bescheid' });
  });
});
