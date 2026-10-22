import { describe, expect, it } from 'vitest';
import { inboxShift, placeRows, type MovableDocument } from '@/app/(shell)/dms/document-moves';

/**
 * Backlog 45 (Restposten 0.2.4): Der neue Ort stand erst nach der Antwort des Servers in den Zeilen. Ein zweiter Zug
 * desselben Dokuments vorher nahm den alten Ort als Ziel für „Rückgängig“.
 */
describe('placeRows', () => {
  const row = (id: string, folder: string | null): MovableDocument => ({ id, folder, subject: `Brief ${id}`, direction: 'incoming' });

  it('notes the new place at once, before the server answers', () => {
    const rows = new Map([['d1', row('d1', 'Vorstand')]]);
    placeRows(rows, [{ id: 'd1', from: 'Vorstand', title: 'Brief d1', direction: 'incoming' }], 'Verträge');
    expect(rows.get('d1')!.folder).toBe('Verträge');
  });

  it('restores what was there when the move is refused, also a row it did not know before', () => {
    const rows = new Map([['d1', row('d1', 'Vorstand')]]);
    const restore = placeRows(rows, [
      { id: 'd1', from: 'Vorstand', title: 'Brief d1', direction: 'incoming' },
      { id: 'd2', from: null, title: 'Brief d2', direction: 'outgoing' },
    ], null);
    expect(rows.get('d2')).toEqual({ id: 'd2', folder: null, subject: 'Brief d2', direction: 'outgoing' });
    restore();
    expect(rows.get('d1')).toEqual(row('d1', 'Vorstand'));
    expect(rows.has('d2')).toBe(false);
  });
});

/** Backlog 45: Der Zähler des Eingangskorbs lief beim Verschieben nicht mit; er kam erst mit dem Neuladen. */
describe('inboxShift', () => {
  const direction = (id: string): MovableDocument['direction'] => (id.startsWith('out') ? 'outgoing' : 'incoming');

  it('counts incoming documents that leave or enter the inbox while the move runs', () => {
    expect(inboxShift([{ id: 'in1', from: null, to: 'Vorstand' }, { id: 'in2', from: null, to: 'Verträge' }], direction)).toBe(-2);
    expect(inboxShift([{ id: 'in1', from: 'Vorstand', to: null }], direction)).toBe(1);
  });

  it('ignores outgoing documents (they lie under „Kein Ordner“), moves between folders and unknown rows', () => {
    expect(inboxShift([{ id: 'out1', from: null, to: 'Vorstand' }, { id: 'in1', from: 'Vorstand', to: 'Verträge' }], direction)).toBe(0);
    expect(inboxShift([{ id: 'x', from: null, to: 'Vorstand' }], () => undefined)).toBe(0);
  });
});
