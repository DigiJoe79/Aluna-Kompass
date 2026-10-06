import { describe, expect, it } from 'vitest';
import { QR_QUIET_ZONE, qrRows } from '../src/print/qr';

describe('qrRows', () => {
  it('is a square of 0/1 rows with a quiet zone of four modules', () => {
    const rows = qrRows('https://example.org/tiere/mika/');
    expect(rows.length).toBeGreaterThanOrEqual(21 + 2 * QR_QUIET_ZONE);
    for (const row of rows) expect(row).toMatch(new RegExp(`^[01]{${rows.length}}$`));
    expect(rows.slice(0, QR_QUIET_ZONE).every((r) => !r.includes('1'))).toBe(true);
    expect(rows.slice(-QR_QUIET_ZONE).every((r) => !r.includes('1'))).toBe(true);
  });

  it('starts with the finder pattern after the quiet zone and is deterministic', () => {
    const rows = qrRows('https://example.org/tiere/mika/');
    expect(rows[QR_QUIET_ZONE]!.slice(QR_QUIET_ZONE, QR_QUIET_ZONE + 7)).toBe('1111111');
    expect(qrRows('https://example.org/tiere/mika/')).toEqual(rows);
  });
});
