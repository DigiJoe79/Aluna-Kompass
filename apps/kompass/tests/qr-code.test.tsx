import { renderToStaticMarkup } from 'react-dom/server';
import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { QrCode } from '@/components/ui/qr-code';

/**
 * N5: der EPC-QR als <svg> aus der Modulmatrix von `qrcode-generator` — kein
 * `dangerouslySetInnerHTML`. Kein DOM nötig: `renderToStaticMarkup` reicht,
 * die App-Tests laufen sonst im Node-Umfeld (`vitest.config.ts`).
 */
describe('QrCode', () => {
  it('renders one rect per dark module plus a white quiet zone', () => {
    const payload = 'BCD\n002\n1\nSCT\n\nHanna Vogt\nDE19999999990000123456\nEUR12.50\n\n\nKE-2026-003\n';
    const qr = qrcode(0, 'M');
    qr.addData(payload, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let darkModules = 0;
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) darkModules++;
      }
    }

    const markup = renderToStaticMarkup(<QrCode payload={payload} size={160} label="QR-Code für die Überweisung an Hanna Vogt" />);

    expect(markup).not.toContain('dangerouslySetInnerHTML');
    const rectCount = markup.match(/<rect\b/g)?.length ?? 0;
    expect(rectCount).toBe(darkModules + 1); // + das weisse Hintergrundrechteck (Quiet Zone)
    expect(markup).toContain(`viewBox="0 0 ${count + 8} ${count + 8}"`);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="QR-Code für die Überweisung an Hanna Vogt"');
    expect(markup).toContain('fill="#fff"');
    expect(markup).toMatch(/fill="#000"/);
  });

  it('renders nothing for an empty payload', () => {
    expect(QrCode({ payload: '', size: 160, label: 'x' })).toBeNull();
    expect(QrCode({ payload: null, size: 160, label: 'x' })).toBeNull();
  });
});
